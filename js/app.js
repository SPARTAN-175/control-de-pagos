import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  sendEmailVerification
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  updateDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js";

import { firebaseConfig } from "../firebase-config.js";


/* =========================================================
   FIREBASE
========================================================= */

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);


/* =========================================================
   HELPERS
========================================================= */

const $ = (s) => document.querySelector(s);

const $$ = (s) => [...document.querySelectorAll(s)];

let currentUser = null;
let profile = {};
let clients = [];
let payments = [];

let unsubClients = null;
let unsubPayments = null;

let deferredInstall = null;


/* =========================================================
   FECHAS / DINERO
========================================================= */

const isoDate = (d = new Date()) => {
  const x = new Date(
    d.getTime() -
    d.getTimezoneOffset() * 60000
  );

  return x.toISOString().slice(0, 10);
};


const money = (n) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(Number(n) || 0);


const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(
    d.getMonth() + 1
  ).padStart(2, "0")}`;


const escapeHtml = (s = "") =>
  String(s).replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c])
  );

/* =========================================================
   DATOS / IMÁGENES / CSV
========================================================= */

const normalizeText = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "");

const csvEscape = (value = "") => {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
};

const downloadText = (filename, content, mime = "text/csv;charset=utf-8") => {
  const blob = new Blob(["\uFEFF", content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const formatCsvDate = value => {
  if (!value) return "";
  if (value?.toDate) return isoDate(value.toDate());
  return String(value);
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  text = String(text || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      if (next !== "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      }
    } else {
      cell += ch;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter(r => r.some(v => String(v).trim() !== ""));
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];

  const headers = rows.shift().map(h => normalizeText(h));
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i] ?? "");
    return obj;
  });
}

const CLIENT_CSV_HEADERS = [
  "ID",
  "Nombre",
  "Teléfono",
  "Referencia",
  "Dirección",
  "Servicio",
  "Mensualidad",
  "Fecha de pago",
  "Estado",
  "Notas",
  "Foto"
];

function clientToCsvRow(c) {
  return [
    c.id || "",
    c.name || "",
    c.phone || "",
    c.reference || "",
    c.address || "",
    c.service || "Internet",
    Number(c.amount) || 0,
    c.dueDate || "",
    c.currentPaymentStatus || "pending",
    c.notes || "",
    c.photoName || ""
  ].map(csvEscape).join(",");
}

function paymentToCsvRow(p) {
  return [
    p.id || "",
    p.clientId || "",
    p.clientName || "",
    Number(p.amount) || 0,
    p.paidDate || "",
    p.month || "",
    p.method || "",
    p.note || ""
  ].map(csvEscape).join(",");
}

function clientMatchesFile(client, filename) {
  const key = normalizeText(filename);
  return Boolean(
    (client.id && normalizeText(client.id) === key) ||
    (client.name && normalizeText(client.name) === key) ||
    (client.reference && normalizeText(client.reference) === key)
  );
}

let bulkImageFiles = [];

function renderBulkImageList() {
  const box = $("#bulkImageList");
  if (!box) return;

  if (!bulkImageFiles.length) {
    box.className = "bulk-image-list empty-state";
    box.textContent = "Aún no has seleccionado imágenes.";
    return;
  }

  box.className = "bulk-image-list";
  box.innerHTML = bulkImageFiles.map((file, i) => `
    <div class="bulk-image-item">
      <img src="${escapeHtml(URL.createObjectURL(file))}" alt="">
      <div class="grow">
        <strong>${escapeHtml(file.name)}</strong>
        <span>${(file.size / 1024 / 1024).toFixed(2)} MB</span>
      </div>
      <span class="badge pending">${i + 1}</span>
    </div>
  `).join("");
}

function addBulkImageFiles(files) {
  const accepted = [...files].filter(file =>
    file.type.startsWith("image/")
  );

  const unique = new Map(
    [...bulkImageFiles, ...accepted]
      .map(file => [`${file.name}|${file.size}|${file.lastModified}`, file])
  );

  bulkImageFiles = [...unique.values()];
  renderBulkImageList();
}

async function uploadClientImage(file, client) {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error(`La imagen "${file.name}" supera 5 MB.`);
  }

  const clientRef = doc(
    db,
    "users",
    currentUser.uid,
    "clients",
    client.id
  );

  const storageRef = ref(
    storage,
    `users/${currentUser.uid}/clients/${client.id}/profile`
  );

  await uploadBytes(storageRef, file, {
    contentType: file.type,
    customMetadata: {
      clientId: client.id,
      originalName: file.name
    }
  });

  const url = await getDownloadURL(storageRef);

  await updateDoc(clientRef, {
    photoURL: url,
    photoName: file.name,
    updatedAt: serverTimestamp()
  });

  client.photoURL = url;
  client.photoName = file.name;
  return url;
}

async function uploadBulkImages() {
  if (!currentUser) throw new Error("Tu sesión no está activa.");
  if (!bulkImageFiles.length) throw new Error("Selecciona al menos una imagen.");

  const progress = $("#bulkImageProgress");
  const bar = $("#bulkImageProgressBar");
  const label = $("#bulkImageProgressText");

  progress?.classList.remove("hidden");

  let done = 0;
  let linked = 0;
  let resources = 0;

  for (const file of bulkImageFiles) {
    if (file.size > 5 * 1024 * 1024) {
      throw new Error(`La imagen "${file.name}" supera 5 MB.`);
    }

    const client = clients.find(c => clientMatchesFile(c, file.name));

    if (client) {
      await uploadClientImage(file, client);
      linked++;
    } else {
      const assetId = normalizeText(file.name) || `asset-${Date.now()}`;
      const safeName =
        assetId +
        "-" +
        String(file.size);

      const storageRef = ref(
        storage,
        `users/${currentUser.uid}/assets/${safeName}`
      );

      await uploadBytes(storageRef, file, {
        contentType: file.type,
        customMetadata: {
          originalName: file.name
        }
      });

      const url = await getDownloadURL(storageRef);

      await setDoc(
        doc(db, "users", currentUser.uid, "assets", assetId),
        {
          name: file.name,
          normalizedName: assetId,
          url,
          storagePath: storageRef.fullPath,
          size: file.size,
          contentType: file.type,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      resources++;
    }

    done++;

    if (label) label.textContent = `${done} / ${bulkImageFiles.length}`;
    if (bar) bar.style.width = `${(done / bulkImageFiles.length) * 100}%`;
  }

  bulkImageFiles = [];
  renderBulkImageList();

  toast(
    `Listo: ${linked} fotos asociadas a clientes y ${resources} recursos guardados en Firebase.`
  );
}

function exportClientsCsv() {
  const content = [
    CLIENT_CSV_HEADERS.join(","),
    ...clients.map(clientToCsvRow)
  ].join("\r\n");

  downloadText(
    `clientes-cahesa-${isoDate()}.csv`,
    content
  );
}

function downloadClientTemplate() {
  const example = [
    "EJEMPLO-001",
    "Juan Pérez",
    "9931234567",
    "Centro",
    "Calle Principal #10",
    "Internet",
    "300",
    isoDate(),
    "pending",
    "Cliente de ejemplo",
    "EJEMPLO-001.jpg"
  ].map(csvEscape).join(",");

  downloadText(
    "plantilla-clientes-cahesa.csv",
    `${CLIENT_CSV_HEADERS.join(",")}\r\n${example}\r\n`
  );
}

function exportPaymentsCsv() {
  const headers = [
    "ID", "Cliente ID", "Cliente", "Monto",
    "Fecha de pago", "Mes", "Método", "Nota"
  ];

  const content = [
    headers.join(","),
    ...payments.map(paymentToCsvRow)
  ].join("\r\n");

  downloadText(
    `pagos-cahesa-${isoDate()}.csv`,
    content
  );
}

async function importClientsCsv(file) {
  if (!currentUser) throw new Error("Tu sesión no está activa.");

  const text = await file.text();
  const rows = csvToObjects(text);

  if (!rows.length) {
    throw new Error("El archivo no contiene registros.");
  }

  const normalizedRows = rows.map(row => ({
    id: row.id?.trim() || "",
    name: row.nombre?.trim() || "",
    phone: row.telefono?.trim() || "",
    reference: row.referencia?.trim() || "",
    address: row.direccion?.trim() || "",
    service: row.servicio?.trim() || "Internet",
    amount: Number(String(row.mensualidad || "0").replace(/[$,\s]/g, "")) || 0,
    dueDate: row.fechadepago?.trim() || isoDate(),
    currentPaymentStatus:
      ["paid", "pagado"].includes((row.estado || "").trim().toLowerCase())
        ? "paid"
        : "pending",
    notes: row.notas?.trim() || "",
    photoName: row.foto?.trim() || ""
  })).filter(row => row.name);

  if (!normalizedRows.length) {
    throw new Error("No encontré filas con nombre de cliente.");
  }

  let created = 0;
  let updated = 0;

  for (let start = 0; start < normalizedRows.length; start += 450) {
    const chunk = normalizedRows.slice(start, start + 450);
    const batch = writeBatch(db);

    for (const row of chunk) {
      let existing = null;

      if (row.id) {
        existing = clients.find(c => c.id === row.id) || null;
      }

      if (!existing) {
        const normalizedName = normalizeText(row.name);
        existing = clients.find(c =>
          normalizeText(c.name) === normalizedName
        ) || null;
      }

      const clientRef = existing
        ? doc(db, "users", currentUser.uid, "clients", existing.id)
        : doc(collection(db, "users", currentUser.uid, "clients"));

      const data = {
        name: row.name,
        phone: row.phone,
        reference: row.reference,
        address: row.address,
        service: row.service,
        amount: row.amount,
        dueDate: row.dueDate,
        currentPaymentStatus: row.currentPaymentStatus,
        notes: row.notes,
        active: existing?.active !== false,
        updatedAt: serverTimestamp()
      };

      if (row.photoName) {
        const existingPhoto = existing?.photoURL || "";
        if (existingPhoto) {
          data.photoURL = existingPhoto;
          data.photoName = row.photoName;
        } else {
          const assetId =
            normalizeText(row.photoName);

          if (assetId) {
            try {
              const assetSnap = await getDoc(
                doc(
                  db,
                  "users",
                  currentUser.uid,
                  "assets",
                  assetId
                )
              );

              if (assetSnap.exists()) {
                data.photoURL = assetSnap.data().url || "";
                data.photoName = row.photoName;
              }
            } catch (assetErr) {
              console.warn("No se pudo resolver la foto importada:", assetErr);
            }
          }
        }
      }

      if (!existing) {
        data.createdAt = serverTimestamp();
        created++;
      } else {
        updated++;
      }

      batch.set(clientRef, data, { merge: true });
    }

    await batch.commit();
  }

  toast(`Importación terminada: ${created} nuevos, ${updated} actualizados.`);
}



/* =========================================================
   UI
========================================================= */

function toast(msg, type = "ok") {

  const el = $("#toast");

  if (!el) return;

  el.textContent = msg;

  el.className = `toast show ${type}`;

  clearTimeout(window.__toast);

  window.__toast = setTimeout(() => {
    el.className = "toast";
  }, 3500);
}


function showLoading(v) {

  const el = $("#loading");

  if (!el) return;

  el.classList.toggle("hidden", !v);
}


/* =========================================================
   ERRORES FIREBASE
========================================================= */

function friendlyError(err) {

  const code = err?.code || "";

  const map = {

    "auth/invalid-credential":
      "Correo o contraseña incorrectos.",

    "auth/invalid-email":
      "El correo no tiene un formato válido.",

    "auth/email-already-in-use":
      "Ese correo ya está registrado.",

    "auth/weak-password":
      "La contraseña debe tener al menos 6 caracteres.",

    "auth/user-not-found":
      "No existe una cuenta con ese correo.",

    "auth/too-many-requests":
      "Hay demasiados intentos. Espera un momento e inténtalo de nuevo.",

    "auth/network-request-failed":
      "No hay conexión con Firebase.",

    "auth/operation-not-allowed":
      "El acceso por correo/contraseña todavía no está habilitado en Firebase.",

    "auth/unauthorized-domain":
      "Este dominio todavía no está autorizado en Firebase Authentication.",

    "permission-denied":
      "Firebase rechazó la operación por las reglas de seguridad.",

    "storage/unauthorized":
      "Firebase Storage rechazó la imagen por las reglas de seguridad.",

    "storage/unknown":
      "Firebase Storage devolvió un error desconocido."

  };

  return map[code] ||
    err?.message ||
    "Ocurrió un error.";
}


/* =========================================================
   CAMBIO DE PANELES DE AUTENTICACIÓN
========================================================= */

function switchAuth(panel) {

  [
    "loginPanel",
    "registerPanel",
    "resetPanel"
  ].forEach(id => {

    const el = $("#" + id);

    if (el) {
      el.classList.toggle(
        "hidden",
        id !== panel
      );
    }

  });

}


/* =========================================================
   AUTENTICACIÓN
========================================================= */

$("#showRegister").onclick = () =>
  switchAuth("registerPanel");


$("#showReset").onclick = () =>
  switchAuth("resetPanel");


$("#backLogin1").onclick = () =>
  switchAuth("loginPanel");


$("#backLogin2").onclick = () =>
  switchAuth("loginPanel");


/* ---------- LOGIN ---------- */

$("#loginForm").addEventListener(
  "submit",
  async e => {

    e.preventDefault();

    showLoading(true);

    try {

      await signInWithEmailAndPassword(
        auth,
        $("#loginEmail").value.trim(),
        $("#loginPassword").value
      );

    } catch (err) {

      console.error(
        "ERROR LOGIN:",
        err
      );

      toast(
        friendlyError(err),
        "error"
      );

    } finally {

      showLoading(false);

    }

  }
);


/* ---------- REGISTRO ---------- */

$("#registerForm").addEventListener(
  "submit",
  async e => {

    e.preventDefault();

    if (
      $("#registerPassword").value !==
      $("#registerPassword2").value
    ) {

      toast(
        "Las contraseñas no coinciden.",
        "error"
      );

      return;
    }

    showLoading(true);

    try {

      const cred =
        await createUserWithEmailAndPassword(
          auth,
          $("#registerEmail").value.trim(),
          $("#registerPassword").value
        );


      const name =
        $("#registerName").value.trim();


      await updateProfile(
        cred.user,
        {
          displayName: name
        }
      );


      await setDoc(
        doc(
          db,
          "users",
          cred.user.uid
        ),
        {
          uid: cred.user.uid,
          name,
          email: cred.user.email,
          phone: "",
          photoURL: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }
      );


      toast(
        "Cuenta creada correctamente."
      );

    } catch (err) {

      console.error(
        "ERROR REGISTRO:",
        err
      );

      toast(
        friendlyError(err),
        "error"
      );

    } finally {

      showLoading(false);

    }

  }
);


/* ---------- RECUPERAR CONTRASEÑA ---------- */

$("#resetForm").addEventListener(
  "submit",
  async e => {

    e.preventDefault();

    showLoading(true);

    try {

      await sendPasswordResetEmail(
        auth,
        $("#resetEmail").value.trim()
      );

      toast(
        "Listo. Revisa tu correo y también la carpeta de spam."
      );

      $("#resetForm").reset();

    } catch (err) {

      console.error(
        "ERROR RECUPERACIÓN:",
        err
      );

      toast(
        friendlyError(err),
        "error"
      );

    } finally {

      showLoading(false);

    }

  }
);


/* =========================================================
   CERRAR SESIÓN
========================================================= */

$("#logoutBtn").onclick = () =>
  signOut(auth);


/* =========================================================
   VISIBILIDAD DE LA APP
========================================================= */

function setAppVisible(logged) {

  $("#authView").classList.toggle(
    "hidden",
    logged
  );

  $("#appView").classList.toggle(
    "hidden",
    !logged
  );

}


/* =========================================================
   PERFIL
========================================================= */

function renderProfile() {

  const name =
    profile.name ||
    currentUser.displayName ||
    "Usuario";


  $("#topName").textContent = name;

  $("#welcomeName").textContent =
    name.split(" ")[0];


  $("#profileName").value =
    name;


  $("#profileEmail").value =
    currentUser.email || "";


  $("#profilePhone").value =
    profile.phone || "";


  const photo =
    profile.photoURL ||
    currentUser?.photoURL ||
    "img/perfil.jpg";


  $("#topAvatar").src = photo;

  $("#profileAvatar").src = photo;

}


/* =========================================================
   ESTADO DE AUTENTICACIÓN
========================================================= */

onAuthStateChanged(
  auth,
  async user => {

    if (!user) {

      currentUser = null;

      if (unsubClients)
        unsubClients();

      if (unsubPayments)
        unsubPayments();

      setAppVisible(false);

      return;
    }


    currentUser = user;

    setAppVisible(true);

    showLoading(true);


    try {

      const snap =
        await getDoc(
          doc(
            db,
            "users",
            user.uid
          )
        );


      profile =
        snap.exists()
          ? snap.data()
          : {
              name: user.displayName || "",
              email: user.email || ""
            };


      renderProfile();

      subscribeData();

    } catch (err) {

      console.error(
        "ERROR CARGANDO PERFIL:",
        err
      );

      toast(
        friendlyError(err),
        "error"
      );

    } finally {

      showLoading(false);

    }

  }
);


/* =========================================================
   SUSCRIPCIÓN FIRESTORE
========================================================= */

function subscribeData() {

  if (unsubClients)
    unsubClients();

  if (unsubPayments)
    unsubPayments();


  /* ---------- CLIENTES ---------- */

  const cq =
    query(
      collection(
        db,
        "users",
        currentUser.uid,
        "clients"
      ),
      orderBy("name")
    );


  unsubClients =
    onSnapshot(
      cq,
      snapshot => {

        clients =
          snapshot.docs.map(
            d => ({
              id: d.id,
              ...d.data()
            })
          );


        renderAll();

      },
      err => {

        console.error(
          "ERROR CLIENTES:",
          err
        );

        toast(
          friendlyError(err),
          "error"
        );

      }
    );


  /* ---------- PAGOS ---------- */

  const pq =
    query(
      collection(
        db,
        "users",
        currentUser.uid,
        "payments"
      ),
      orderBy("paidAt", "desc")
    );


  unsubPayments =
    onSnapshot(
      pq,
      snapshot => {

        payments =
          snapshot.docs.map(
            d => ({
              id: d.id,
              ...d.data()
            })
          );


        renderAll();

      },
      err => {

        console.error(
          "ERROR PAGOS:",
          err
        );

        toast(
          friendlyError(err),
          "error"
        );

      }
    );

  }

  
/* =========================================================
   ESTADO DEL CLIENTE
========================================================= */

function clientStatus(c) {

  if (
    c.currentPaymentStatus === "paid"
  )
    return "paid";


  if (
    c.dueDate &&
    c.dueDate < isoDate()
  )
    return "overdue";


  return "pending";

}


function statusLabel(s) {

  return s === "paid"
    ? "Pagado"
    : s === "overdue"
      ? "Vencido"
      : "Pendiente";

}


/* =========================================================
   RENDER GENERAL
========================================================= */

function renderAll() {

  renderDashboard();
  renderClients();
  renderPayments();
  renderHistory();

}


/* =========================================================
   DASHBOARD
========================================================= */

function renderDashboard() {

  const active =
    clients.filter(
      c => c.active !== false
    );


  const mk =
    monthKey();


  const paidThis =
    payments.filter(
      p => p.month === mk
    );


  const paidIds =
    new Set(
      paidThis.map(
        p => p.clientId
      )
    );


  const pending =
    active.filter(
      c =>
        !paidIds.has(c.id) &&
        clientStatus(c) !== "paid"
    );


  const overdue =
    pending.filter(
      c =>
        c.dueDate &&
        c.dueDate < isoDate()
    );


  const collected =
    paidThis.reduce(
      (a, p) =>
        a + Number(p.amount || 0),
      0
    );


  const due =
    pending.reduce(
      (a, c) =>
        a + Number(c.amount || 0),
      0
    );


  $("#statClients").textContent =
    active.length;


  $("#statPaid").textContent =
    paidThis.length;


  $("#statPending").textContent =
    pending.length;


  $("#statOverdue").textContent =
    overdue.length;


  $("#statCollected").textContent =
    money(collected);


  $("#statDue").textContent =
    money(due);


  const list =
    pending.slice(0, 8);


  $("#dueList").className =
    list.length
      ? "client-list"
      : "client-list empty-state";


  $("#dueList").innerHTML =
    list.length
      ? list.map(clientRowHtml).join("")
      : "No hay pagos pendientes. 🎉";

}


/* =========================================================
   FILA DE CLIENTE
========================================================= */

function clientRowHtml(c) {

  const s =
    clientStatus(c);


  return `
    <div
      class="client-row"
      data-id="${escapeHtml(c.id)}"
    >

      <img
        src="${escapeHtml(
          c.photoURL || "img/perfil.jpg"
        )}"
        alt=""
      >

      <div class="grow">

        <strong>
          ${escapeHtml(c.name)}
        </strong>

        <span>
          ${escapeHtml(
            c.service || "Internet"
          )}
          ·
          ${money(c.amount)}
          · vence
          ${escapeHtml(
            c.dueDate || "—"
          )}
        </span>

      </div>

      <span
        class="badge ${s}"
      >
        ${statusLabel(s)}
      </span>

      <button
        class="small primary"
        data-pay="${escapeHtml(c.id)}"
      >
        Pagar
      </button>

    </div>
  `;

}


/* =========================================================
   CLIENTES
========================================================= */

function renderClients() {

  const q =
    ($("#clientSearch")?.value || "")
      .toLowerCase()
      .trim();


  const f =
    $("#clientFilter")?.value ||
    "all";


  const arr =
    clients.filter(
      c =>
        (
          !q ||
          `${c.name} ${
            c.phone || ""
          } ${
            c.reference || ""
          }`
            .toLowerCase()
            .includes(q)
        )
        &&
        (
          f === "all" ||
          clientStatus(c) === f
        )
    );


  $("#clientsGrid").className =
    arr.length
      ? "clients-grid"
      : "clients-grid empty-state";


  $("#clientsGrid").innerHTML =
    arr.length
      ? arr.map(c => `

        <article class="client-card">

          <div class="client-cover">

            <img
              src="${escapeHtml(
                c.photoURL ||
                "img/perfil.jpg"
              )}"
              alt=""
            >

            <span
              class="badge ${clientStatus(c)}"
            >
              ${statusLabel(
                clientStatus(c)
              )}
            </span>

          </div>


          <div class="client-body">

            <h3>
              ${escapeHtml(c.name)}
            </h3>

            <p>
              ${escapeHtml(
                c.service || "Internet"
              )}
              ·
              ${money(c.amount)}/mes
            </p>


            <div class="client-meta">

              <span>
                📅
                ${escapeHtml(
                  c.dueDate || "—"
                )}
              </span>

              <span>
                ☎
                ${escapeHtml(
                  c.phone ||
                  "Sin teléfono"
                )}
              </span>

            </div>


            <div class="card-actions">

              <button
                class="ghost"
                data-edit="${escapeHtml(c.id)}"
              >
                Editar
              </button>

              <button
                class="primary"
                data-pay="${escapeHtml(c.id)}"
              >
                Registrar pago
              </button>

            </div>

          </div>

        </article>

      `).join("")
      : "No hay clientes que coincidan con el filtro.";

}


/* =========================================================
   PAGOS
========================================================= */

function renderPayments() {

  const q =
    ($("#paymentSearch")?.value || "")
      .toLowerCase()
      .trim();


  const f =
    $("#paymentFilter")?.value ||
    "all";


  const arr =
    clients.filter(
      c =>
        (
          !q ||
          c.name
            .toLowerCase()
            .includes(q)
        )
        &&
        (
          f === "all" ||
          clientStatus(c) === f
        )
    );


  $("#paymentsList").className =
    arr.length
      ? "payment-list"
      : "payment-list empty-state";


  $("#paymentsList").innerHTML =
    arr.length
      ? arr.map(clientRowHtml).join("")
      : "No hay clientes.";

}


/* =========================================================
   HISTORIAL
========================================================= */

function renderHistory() {

  const q =
    ($("#historySearch")?.value || "")
      .toLowerCase()
      .trim();


  const m =
    $("#historyMonth")?.value ||
    "";


  const arr =
    payments.filter(
      p =>
        (
          !q ||
          (p.clientName || "")
            .toLowerCase()
            .includes(q)
        )
        &&
        (
          !m ||
          p.month === m
        )
    );


  $("#historyList").className =
    arr.length
      ? "history-list"
      : "history-list empty-state";


  $("#historyList").innerHTML =
    arr.length
      ? arr.map(p => `

        <div class="history-row">

          <div>

            <strong>
              ${escapeHtml(
                p.clientName ||
                "Cliente"
              )}
            </strong>

            <span>
              ${escapeHtml(
                p.method ||
                "Efectivo"
              )}
              ·
              ${escapeHtml(
                p.paidDate ||
                ""
              )}
            </span>

          </div>

          <strong class="amount-positive">
            ${money(p.amount)}
          </strong>

        </div>

      `).join("")
      : "No hay pagos registrados.";

}


/* =========================================================
   FILTROS
========================================================= */

[
  "clientSearch",
  "clientFilter",
  "paymentSearch",
  "paymentFilter",
  "historySearch",
  "historyMonth"
].forEach(id => {

  const el = $("#" + id);

  if (el) {
    el.addEventListener(
      "input",
      renderAll
    );
  }

});


$("#historyMonth").value =
  monthKey();


/* =========================================================
   DIALOGO CLIENTE
========================================================= */

function openClientDialog(c = null) {

  $("#clientDialogTitle").textContent =
    c
      ? "Editar cliente"
      : "Nuevo cliente";


  $("#clientId").value =
    c?.id || "";


  $("#clientName").value =
    c?.name || "";


  $("#clientPhone").value =
    c?.phone || "";


  $("#clientReference").value =
    c?.reference || "";


  $("#clientAddress").value =
    c?.address || "";


  $("#clientService").value =
    c?.service || "Internet";


  $("#clientAmount").value =
    c?.amount ?? 100;


  $("#clientDueDate").value =
    c?.dueDate || isoDate();


  $("#clientStatus").value =
    c?.currentPaymentStatus ||
    "pending";


  $("#clientNotes").value =
    c?.notes || "";


  $("#clientPhoto").value =
    "";


  $("#clientDialog").showModal();

}


/* =========================================================
   SUBIR IMAGEN
========================================================= */

async function uploadImage(file, path) {

  if (!file)
    return "";


  if (!file.type.startsWith("image/")) {
    throw new Error(
      "El archivo seleccionado no es una imagen."
    );
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error(
      "La imagen debe pesar menos de 5 MB."
    );
  }

  const allowed = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
  ];

  if (!allowed.includes(file.type)) {
    throw new Error(
      "Formato no permitido. Usa JPG, PNG, WEBP o GIF."
    );
  }


  const r =
    ref(
      storage,
      path
    );


  await uploadBytes(
    r,
    file,
    {
      contentType: file.type
    }
  );


  return await getDownloadURL(r);

}


/* =========================================================
   GUARDAR CLIENTE
========================================================= */

$("#clientForm").addEventListener(
  "submit",
  async e => {

    e.preventDefault();


    if (!currentUser) {

      toast(
        "Tu sesión no está activa. Vuelve a iniciar sesión.",
        "error"
      );

      return;

    }


    const saveBtn =
      $("#saveClientBtn");


    saveBtn.disabled = true;

    saveBtn.textContent =
      "Guardando...";


    showLoading(true);


    try {

      /* -----------------------------------------
         DATOS BÁSICOS
      ----------------------------------------- */

      const id =
        $("#clientId").value;


      const oldClient =
        id
          ? clients.find(
              c => c.id === id
            )
          : null;


      const name =
        $("#clientName")
          .value
          .trim();


      const amount =
        Number(
          $("#clientAmount").value
        );


      const dueDate =
        $("#clientDueDate").value;


      /* -----------------------------------------
         VALIDACIONES
      ----------------------------------------- */

      if (!name) {

        throw new Error(
          "Escribe el nombre del cliente."
        );

      }


      if (
        !Number.isFinite(amount) ||
        amount < 0
      ) {

        throw new Error(
          "La mensualidad no es válida."
        );

      }


      if (!dueDate) {

        throw new Error(
          "Selecciona la fecha de pago."
        );

      }


      /* -----------------------------------------
         DATOS DEL CLIENTE
      ----------------------------------------- */

      const data = {

        name,

        phone:
          $("#clientPhone")
            .value
            .trim(),

        reference:
          $("#clientReference")
            .value
            .trim(),

        address:
          $("#clientAddress")
            .value
            .trim(),

        service:
          $("#clientService")
            .value
            .trim() ||
          "Internet",

        amount,

        dueDate,

        currentPaymentStatus:
          $("#clientStatus").value,

        notes:
          $("#clientNotes")
            .value
            .trim(),

        photoURL:
          oldClient?.photoURL || "",

        active: true,

        updatedAt:
          serverTimestamp()

      };


      /* -----------------------------------------
         CREAR REFERENCIA DEL DOCUMENTO
         
         IMPORTANTE:
         Generamos primero el ID del cliente.
         Así la fotografía y el documento usan
         exactamente el mismo ID.
      ----------------------------------------- */

      let clientRef;


      if (id) {

        clientRef =
          doc(
            db,
            "users",
            currentUser.uid,
            "clients",
            id
          );

      } else {

        clientRef =
          doc(
            collection(
              db,
              "users",
              currentUser.uid,
              "clients"
            )
          );


        data.createdAt =
          serverTimestamp();

      }


      /* -----------------------------------------
         FOTOGRAFÍA
      ----------------------------------------- */

      const file =
        $("#clientPhoto")
          .files[0];


      if (file) {

        data.photoURL =
          await uploadImage(
            file,
            `users/${currentUser.uid}/clients/${clientRef.id}/profile`
          );

        data.photoName = file.name;

      }


      /* -----------------------------------------
         GUARDAR EN FIRESTORE
      ----------------------------------------- */

      await setDoc(
        clientRef,
        data,
        {
          merge: true
        }
      );


      /* -----------------------------------------
         CERRAR Y LIMPIAR
      ----------------------------------------- */

      $("#clientDialog").close();

      $("#clientForm").reset();


      toast(
        id
          ? "Cliente actualizado correctamente."
          : "Cliente guardado correctamente."
      );


    } catch (err) {

      console.error(
        "ERROR GUARDANDO CLIENTE:",
        err
      );


      toast(
        friendlyError(err),
        "error"
      );


    } finally {

      saveBtn.disabled = false;

      saveBtn.textContent =
        "Guardar cliente";

      showLoading(false);

    }

  }
);


/* =========================================================
   DIALOGO DE PAGO
========================================================= */

function openPaymentDialog(id) {

  const c =
    clients.find(
      x => x.id === id
    );


  if (!c)
    return;


  $("#paymentClientId").value =
    id;


  $("#paymentClientLabel").textContent =
    `${c.name} · ${money(c.amount)}`;


  $("#paymentAmount").value =
    c.amount || 0;


  $("#paymentDate").value =
    isoDate();


  $("#paymentNote").value =
    "";


  $("#paymentDialog").showModal();

}


/* =========================================================
   REGISTRAR PAGO
========================================================= */

$("#paymentForm").addEventListener(
  "submit",
  async e => {

    e.preventDefault();

    if (!currentUser) {

      toast(
        "Tu sesión no está activa.",
        "error"
      );

      return;

    }

    showLoading(true);


    try {

      const id =
        $("#paymentClientId")
          .value;


      const c =
        clients.find(
          x => x.id === id
        );


      if (!c) {

        throw new Error(
          "Cliente no encontrado."
        );

      }


      const paidDate =
        $("#paymentDate")
          .value;


      const amount =
        Number(
          $("#paymentAmount")
            .value
        );


      if (!paidDate) {

        throw new Error(
          "Selecciona la fecha del pago."
        );

      }


      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {

        throw new Error(
          "El importe del pago no es válido."
        );

      }


      const month =
        paidDate.slice(0, 7);


      await addDoc(
        collection(
          db,
          "users",
          currentUser.uid,
          "payments"
        ),
        {

          clientId: id,

          clientName: c.name,

          amount,

          paidDate,

          month,

          method:
            $("#paymentMethod")
              .value,

          note:
            $("#paymentNote")
              .value
              .trim(),

          paidAt:
            serverTimestamp(),

          createdAt:
            serverTimestamp()

        }
      );


      await updateDoc(
        doc(
          db,
          "users",
          currentUser.uid,
          "clients",
          id
        ),
        {

          currentPaymentStatus:
            "paid",

          lastPaymentDate:
            paidDate,

          lastPaymentAmount:
            amount,

          updatedAt:
            serverTimestamp()

        }
      );


      $("#paymentDialog").close();


      toast(
        `Pago de ${money(amount)} registrado.`
      );


    } catch (err) {

      console.error(
        "ERROR REGISTRANDO PAGO:",
        err
      );


      toast(
        friendlyError(err),
        "error"
      );


    } finally {

      showLoading(false);

    }

  }
);


/* =========================================================
   DATOS / IMÁGENES
========================================================= */

$("#exportClientsBtn")?.addEventListener("click", () => {
  try {
    exportClientsCsv();
    toast("Clientes exportados. Puedes abrir el CSV directamente con Excel.");
  } catch (err) {
    console.error("ERROR EXPORTANDO CLIENTES:", err);
    toast(friendlyError(err), "error");
  }
});

$("#downloadClientTemplateBtn")?.addEventListener("click", () => {
  try {
    downloadClientTemplate();
    toast("Plantilla descargada.");
  } catch (err) {
    console.error("ERROR PLANTILLA:", err);
    toast(friendlyError(err), "error");
  }
});

$("#exportPaymentsBtn")?.addEventListener("click", () => {
  try {
    exportPaymentsCsv();
    toast("Pagos exportados correctamente.");
  } catch (err) {
    console.error("ERROR EXPORTANDO PAGOS:", err);
    toast(friendlyError(err), "error");
  }
});

$("#importClientsFile")?.addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;

  showLoading(true);

  try {
    await importClientsCsv(file);
    e.target.value = "";
  } catch (err) {
    console.error("ERROR IMPORTANDO CLIENTES:", err);
    toast(friendlyError(err), "error");
  } finally {
    showLoading(false);
  }
});

$("#bulkImagesFile")?.addEventListener("change", e => {
  addBulkImageFiles(e.target.files);
  e.target.value = "";
});

$("#bulkImagesFolder")?.addEventListener("change", e => {
  addBulkImageFiles(e.target.files);
  e.target.value = "";
});

$("#uploadBulkImagesBtn")?.addEventListener("click", async () => {
  showLoading(true);

  try {
    await uploadBulkImages();
  } catch (err) {
    console.error("ERROR CARGA MASIVA IMÁGENES:", err);
    toast(friendlyError(err), "error");
  } finally {
    showLoading(false);
    setTimeout(() => $("#bulkImageProgress")?.classList.add("hidden"), 800);
  }
});


/* =========================================================
   BOTONES / NAVEGACIÓN
========================================================= */


document.addEventListener(
  "click",
  e => {

    /* Navegación */

    const nav =
      e.target.closest(
        "[data-section]"
      );


    if (nav) {

      goSection(
        nav.dataset.section
      );

      closeSidebar();

    }


    /* Navegación secundaria */

    const go =
      e.target.closest(
        "[data-section-go]"
      );


    if (go) {

      goSection(
        go.dataset.sectionGo
      );

    }


    /* Nuevo cliente */

    const newBtn =
      e.target.closest(
        "[data-action='new-client']"
      );


    if (newBtn) {

      openClientDialog();

    }


    /* Editar cliente */

    const edit =
      e.target.closest(
        "[data-edit]"
      );


    if (edit) {

      const client =
        clients.find(
          c =>
            c.id ===
            edit.dataset.edit
        );


      if (client) {

        openClientDialog(
          client
        );

      }

    }


    /* Registrar pago */

    const pay =
      e.target.closest(
        "[data-pay]"
      );


    if (pay) {

      openPaymentDialog(
        pay.dataset.pay
      );

    }

  }
);


/* =========================================================
   CERRAR DIALOGOS
========================================================= */

document.addEventListener(
  "click",
  e => {

    const closeButton =
      e.target.closest(
        "[data-close-dialog]"
      );


    if (!closeButton)
      return;


    const dialogId =
      closeButton.dataset.closeDialog;


    const dialog =
      document.getElementById(
        dialogId
      );


    if (dialog) {

      dialog.close();

    }

  }
);


/* =========================================================
   SECCIONES
========================================================= */

function goSection(name) {

  const names = {

    dashboard: "Inicio",

    clients: "Clientes",

    payments: "Pagos",

    history: "Historial",

    data: "Datos e imágenes",

    profile: "Mi perfil"

  };


  $$(".page-section")
    .forEach(
      s =>
        s.classList.toggle(
          "hidden",
          s.id !==
          name + "Section"
        )
    );


  $$(".nav-item[data-section]")
    .forEach(
      b =>
        b.classList.toggle(
          "active",
          b.dataset.section === name
        )
    );


  $("#sectionTitle").textContent =
    names[name] ||
    "Inicio";


  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}


/* =========================================================
   SIDEBAR
========================================================= */

function closeSidebar() {

  $("#sidebar")
    .classList
    .remove("open");

}


$("#openMenu").onclick = () =>
  $("#sidebar")
    .classList
    .add("open");


$("#closeMenu").onclick =
  closeSidebar;


/* =========================================================
   PERFIL
========================================================= */

$("#profileForm").addEventListener(
  "submit",
  async e => {

    e.preventDefault();

    showLoading(true);


    try {

      const name =
        $("#profileName")
          .value
          .trim();


      const phone =
        $("#profilePhone")
          .value
          .trim();


      if (!name) {

        throw new Error(
          "Escribe tu nombre."
        );

      }


      await updateDoc(
        doc(
          db,
          "users",
          currentUser.uid
        ),
        {

          name,

          phone,

          updatedAt:
            serverTimestamp()

        }
      );


      await updateProfile(
        currentUser,
        {
          displayName: name
        }
      );


      profile = {
        ...profile,
        name,
        phone
      };


      renderProfile();


      toast(
        "Perfil actualizado."
      );


    } catch (err) {

      console.error(
        "ERROR ACTUALIZANDO PERFIL:",
        err
      );


      toast(
        friendlyError(err),
        "error"
      );


    } finally {

      showLoading(false);

    }

  }
);


/* =========================================================
   FOTO DE PERFIL
========================================================= */

$("#profilePhoto").addEventListener(
  "change",
  async e => {

    const file =
      e.target.files[0];

    if (!file)
      return;

    showLoading(true);

    try {

      // 1. Subimos primero la imagen a Firebase Storage.
      const url =
        await uploadImage(
          file,
          `users/${currentUser.uid}/profile/avatar`
        );

      // 2. Guardamos la URL también en Firebase Authentication.
      // Esto hace que la foto quede disponible aunque Firestore
      // tenga temporalmente un problema con sus reglas.
      await updateProfile(currentUser, {
        photoURL: url
      });

      // 3. Actualizamos inmediatamente la interfaz.
      profile.photoURL = url;
      renderProfile();

      // 4. Intentamos mantener Firestore sincronizado.
      // Si las reglas de Firestore están desactualizadas, la foto
      // ya está guardada en Storage + Authentication y la app no
      // debe mostrar un error ni revertir la imagen.
      try {
        await updateDoc(
          doc(
            db,
            "users",
            currentUser.uid
          ),
          {
            photoURL: url,
            updatedAt: serverTimestamp()
          }
        );
      } catch (firestoreError) {
        console.warn(
          "La foto se guardó en Storage/Authentication, pero no se pudo sincronizar Firestore. Revisa sus reglas.",
          firestoreError
        );
      }

      toast(
        "Foto actualizada correctamente."
      );

    } catch (err) {

      console.error(
        "ERROR FOTO PERFIL:",
        err
      );

      toast(
        friendlyError(err),
        "error"
      );

    } finally {

      showLoading(false);

      // Permite volver a seleccionar la misma imagen.
      e.target.value = "";

    }
  }
);

/* =========================================================
   VERIFICACIÓN DE CORREO
========================================================= */

$("#sendVerification").onclick =
  async () => {

    try {

      await sendEmailVerification(
        currentUser
      );


      toast(
        "Correo de verificación enviado."
      );


    } catch (err) {

      console.error(
        "ERROR VERIFICACIÓN:",
        err
      );


      toast(
        friendlyError(err),
        "error"
      );

    }

  };


/* =========================================================
   INSTALACIÓN PWA
========================================================= */

window.addEventListener(
  "beforeinstallprompt",
  e => {

    e.preventDefault();

    deferredInstall = e;

    $("#installBtn")
      .classList
      .remove("hidden");

  }
);


$("#installBtn").onclick =
  async () => {

    if (!deferredInstall)
      return;


    deferredInstall.prompt();


    await deferredInstall.userChoice;


    deferredInstall = null;


    $("#installBtn")
      .classList
      .add("hidden");

  };


window.addEventListener(
  "appinstalled",
  () =>
    toast(
      "Aplicación instalada correctamente."
    )
);


/* =========================================================
   FECHA ACTUAL
========================================================= */

$("#todayLabel").textContent =
  new Intl.DateTimeFormat(
    "es-MX",
    {
      dateStyle: "full"
    }
  ).format(
    new Date()
  );


/* =========================================================
   SERVICE WORKER
========================================================= */

if (
  "serviceWorker" in navigator
) {

  window.addEventListener(
    "load",
    () => {

      navigator.serviceWorker
        .register("./sw.js")
        .catch(
          err =>
            console.error(
              "Service Worker:",
              err
            )
        );

    }
  );

}
