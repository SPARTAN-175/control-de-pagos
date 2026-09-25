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
  deleteDoc,
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
let networkBoxes = [];

let unsubClients = null;
let unsubPayments = null;
let unsubNetworkBoxes = null;

let networkMap = null;
let networkMarkersLayer = null;
let selectedNetworkBoxId = "";

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

      if (unsubNetworkBoxes)
        unsubNetworkBoxes();

      networkBoxes = [];
      setAppVisible(false);

      return;
    }


    currentUser = user;

    setAppVisible(true);

    showLoading(true);


    try {

      const profileRef = doc(db, "users", user.uid);
      let snap = null;

      try {
        snap = await getDoc(profileRef);
      } catch (profileErr) {
        // No bloqueamos toda la aplicación si el perfil todavía no puede
        // leerse. Authentication sigue siendo la fuente mínima de identidad.
        console.warn("No se pudo leer el perfil de Firestore; usando Authentication como respaldo:", profileErr);
      }

      profile = snap?.exists()
        ? snap.data()
        : {
            name: user.displayName || "",
            email: user.email || "",
            photoURL: user.photoURL || ""
          };

      renderProfile();

      // Intentamos crear/sincronizar el documento del perfil sin impedir
      // que el resto de la aplicación arranque si las reglas aún no fueron
      // publicadas correctamente.
      if (!snap?.exists()) {
        try {
          await setDoc(profileRef, {
            name: profile.name || "",
            email: profile.email || "",
            photoURL: profile.photoURL || "",
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (profileWriteErr) {
          console.warn("No se pudo crear/sincronizar el perfil en Firestore:", profileWriteErr);
        }
      }

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

  if (unsubNetworkBoxes)
    unsubNetworkBoxes();


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


  const aq = collection(db, "users", currentUser.uid, "assets");
  unsubNetworkBoxes = onSnapshot(
    aq,
    snapshot => {
      networkBoxes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(item => item.type === "networkBox")
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
      renderAll();
    },
    err => { console.error("ERROR CAJAS DE RED:", err); toast(friendlyError(err), "error"); }
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
  renderNetwork();

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

  populateClientNetworkSelect();
  $("#clientNetworkBox").value = c?.networkBoxId || "";
  $("#clientNetworkPort").value = c?.networkPort ?? "";
  $("#clientLatitude").value = c?.latitude ?? "";
  $("#clientLongitude").value = c?.longitude ?? "";


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


function populateClientNetworkSelect() {
  const select = $("#clientNetworkBox");
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Sin asignar</option>` + networkBoxes.map(box => `<option value="${escapeHtml(box.id)}">${escapeHtml(box.name || box.code || box.id)}${box.code ? ` · ${escapeHtml(box.code)}` : ""}</option>`).join("");
  if (current && networkBoxes.some(box => box.id === current)) select.value = current;
}

function useBrowserLocation(latId, lngId) {
  if (!navigator.geolocation) { toast("Este dispositivo no permite obtener la ubicación.", "error"); return; }
  navigator.geolocation.getCurrentPosition(position => {
    $(latId).value = position.coords.latitude.toFixed(7);
    $(lngId).value = position.coords.longitude.toFixed(7);
    toast("Ubicación capturada correctamente.");
  }, () => toast("No se pudo obtener la ubicación. Revisa el permiso de ubicación del navegador.", "error"), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}

$("#clientUseLocationBtn")?.addEventListener("click", () => useBrowserLocation("#clientLatitude", "#clientLongitude"));


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

      const selectedBoxId = $("#clientNetworkBox").value || "";
      const selectedPort = $("#clientNetworkPort").value ? Number($("#clientNetworkPort").value) : null;
      const latitudeValue = $("#clientLatitude").value ? Number($("#clientLatitude").value) : null;
      const longitudeValue = $("#clientLongitude").value ? Number($("#clientLongitude").value) : null;
      if (selectedBoxId) {
        const box = networkBoxes.find(b => b.id === selectedBoxId);
        if (!box) throw new Error("La caja de red seleccionada ya no existe.");
        if (!selectedPort || !Number.isInteger(selectedPort) || selectedPort < 1 || selectedPort > Number(box.capacity || 0)) throw new Error(`El puerto debe estar entre 1 y ${Number(box.capacity || 0)}.`);
        if (clients.some(other => other.id !== id && other.networkBoxId === selectedBoxId && Number(other.networkPort) === selectedPort)) throw new Error("Ese puerto ya está asignado a otro cliente.");
      } else if (selectedPort) {
        throw new Error("Selecciona una caja antes de asignar un puerto.");
      }
      if ((latitudeValue !== null && !Number.isFinite(latitudeValue)) || (longitudeValue !== null && !Number.isFinite(longitudeValue))) throw new Error("Las coordenadas no son válidas.");
      if ((latitudeValue === null) !== (longitudeValue === null)) throw new Error("Captura latitud y longitud juntas.");
      if (latitudeValue !== null && (latitudeValue < -90 || latitudeValue > 90 || longitudeValue < -180 || longitudeValue > 180)) throw new Error("Las coordenadas están fuera de rango.");


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

        networkBoxId: selectedBoxId,
        networkPort: selectedPort,
        latitude: latitudeValue,
        longitude: longitudeValue,

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

    network: "Mapa de red",

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

/* =========================================================
   MAPA DE RED / INFRAESTRUCTURA
========================================================= */

function networkBoxClients(boxId) {
  return clients.filter(c => c.networkBoxId === boxId && c.active !== false);
}

function networkStatusLabel(status) {
  return status === "maintenance" ? "Mantenimiento" : status === "inactive" ? "Inactiva" : "Activa";
}

function initNetworkMap() {
  const el = $("#networkMap");
  if (!el || typeof L === "undefined") return;
  if (!networkMap) {
    networkMap = L.map(el, { zoomControl: true }).setView([19.4326, -99.1332], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(networkMap);
    networkMarkersLayer = L.layerGroup().addTo(networkMap);
  }
  setTimeout(() => networkMap.invalidateSize(), 80);
  renderNetworkMarkers();
}

function renderNetwork() {
  const list = $("#networkBoxesList");
  const detail = $("#networkBoxDetail");
  const stats = $("#networkMapStats");
  if (!list || !detail || !stats) return;

  populateClientNetworkSelect();
  const locatedClients = clients.filter(c => Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude)));
  stats.textContent = `${networkBoxes.length} ${networkBoxes.length === 1 ? "caja" : "cajas"} · ${locatedClients.length} ${locatedClients.length === 1 ? "cliente ubicado" : "clientes ubicados"}`;

  if (!networkBoxes.length) {
    list.className = "network-box-list empty-state";
    list.textContent = "No hay cajas registradas.";
    detail.innerHTML = `<div class="empty-state">Crea una caja para comenzar a construir tu mapa de red.</div>`;
  } else {
    list.className = "network-box-list";
    list.innerHTML = networkBoxes.map(box => {
      const count = networkBoxClients(box.id).length;
      const active = box.id === selectedNetworkBoxId ? " active" : "";
      const status = box.status || "active";
      return `<button type="button" class="network-box-item${active}" data-network-box="${escapeHtml(box.id)}">
        <span class="network-box-dot ${status}"></span>
        <span class="grow"><strong>${escapeHtml(box.name || "Caja sin nombre")}</strong><span>${escapeHtml(box.code || "Sin código")} · ${count}/${Number(box.capacity || 0)} puertos ocupados</span></span>
      </button>`;
    }).join("");
  }

  if (selectedNetworkBoxId && !networkBoxes.some(b => b.id === selectedNetworkBoxId)) selectedNetworkBoxId = "";
  renderNetworkDetail();
  renderNetworkMarkers();
}

function renderNetworkDetail() {
  const detail = $("#networkBoxDetail");
  if (!detail) return;
  const box = networkBoxes.find(b => b.id === selectedNetworkBoxId);
  if (!box) {
    detail.innerHTML = `<div class="empty-state">Selecciona una caja en el mapa o en la lista.</div>`;
    return;
  }

  const capacity = Math.max(1, Number(box.capacity || 1));
  const connected = networkBoxClients(box.id).sort((a,b) => Number(a.networkPort || 0) - Number(b.networkPort || 0));
  const occupiedPorts = new Map(connected.filter(c => c.networkPort).map(c => [Number(c.networkPort), c]));
  const free = Math.max(0, capacity - occupiedPorts.size);

  detail.innerHTML = `
    <div class="section-head">
      <div><h3>${escapeHtml(box.name || "Caja de red")}</h3><p class="muted">${escapeHtml(box.code || "Sin código")} · ${networkStatusLabel(box.status)}</p></div>
      <button type="button" class="ghost small" data-edit-network-box="${escapeHtml(box.id)}">Editar</button>
    </div>
    <div class="network-detail-meta">
      <div><strong>${occupiedPorts.size}</strong><span>Puertos ocupados</span></div>
      <div><strong>${free}</strong><span>Puertos libres</span></div>
      <div><strong>${capacity}</strong><span>Capacidad</span></div>
      <div><strong>${connected.length}</strong><span>Clientes</span></div>
    </div>
    <div><strong>Puertos</strong>
      <div class="port-grid">${Array.from({length: capacity}, (_,i) => {
        const port = i + 1;
        const c = occupiedPorts.get(port);
        return `<button type="button" class="port-chip ${c ? "occupied" : "empty"}" ${c ? `data-focus-client="${escapeHtml(c.id)}"` : ""}>${port}${c ? `<small>${escapeHtml((c.name || "").split(" ")[0])}</small>` : "<small>Libre</small>"}</button>`;
      }).join("")}</div>
    </div>
    ${box.address ? `<p class="muted"><strong>Referencia:</strong> ${escapeHtml(box.address)}</p>` : ""}
    ${box.notes ? `<p class="muted"><strong>Notas:</strong> ${escapeHtml(box.notes)}</p>` : ""}
    <div class="network-client-list">${connected.length ? connected.map(c => `<button type="button" class="network-client-row" data-focus-client="${escapeHtml(c.id)}"><strong>${escapeHtml(c.name)}</strong><span>Puerto ${Number(c.networkPort || 0) || "sin asignar"}${c.phone ? ` · ${escapeHtml(c.phone)}` : ""}</span></button>`).join("") : `<div class="empty-state">Todavía no hay clientes conectados.</div>`}</div>
  `;
}

function renderNetworkMarkers() {
  if (!networkMap || !networkMarkersLayer) return;
  networkMarkersLayer.clearLayers();

  networkBoxes.forEach(box => {
    const lat = Number(box.latitude), lng = Number(box.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const count = networkBoxClients(box.id).length;
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({ className: "", html: `<div class="network-marker-label">${escapeHtml(box.code || box.name || "Caja")}</div>`, iconSize: [90, 28], iconAnchor: [45, 14] })
    });
    marker.bindPopup(`<strong>${escapeHtml(box.name || "Caja")}</strong><br>${escapeHtml(box.code || "Sin código")}<br>${count}/${Number(box.capacity || 0)} puertos ocupados`);
    marker.on("click", () => { selectedNetworkBoxId = box.id; renderNetwork(); });
    marker.addTo(networkMarkersLayer);
  });

  clients.filter(c => Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude))).forEach(c => {
    const marker = L.circleMarker([Number(c.latitude), Number(c.longitude)], { radius: 7, weight: 2, fillOpacity: .9 });
    const box = networkBoxes.find(b => b.id === c.networkBoxId);
    marker.bindPopup(`<strong>${escapeHtml(c.name || "Cliente")}</strong><br>${box ? `${escapeHtml(box.name)} · Puerto ${Number(c.networkPort || 0) || "—"}` : "Sin caja asignada"}`);
    marker.addTo(networkMarkersLayer);
  });
}

function openNetworkBoxDialog(box = null) {
  $("#networkBoxDialogTitle").textContent = box ? "Editar caja de red" : "Nueva caja de red";
  $("#networkBoxId").value = box?.id || "";
  $("#networkBoxName").value = box?.name || "";
  $("#networkBoxCode").value = box?.code || "";
  $("#networkBoxCapacity").value = box?.capacity ?? 8;
  $("#networkBoxStatus").value = box?.status || "active";
  $("#networkBoxAddress").value = box?.address || "";
  $("#networkBoxLatitude").value = box?.latitude ?? "";
  $("#networkBoxLongitude").value = box?.longitude ?? "";
  $("#networkBoxNotes").value = box?.notes || "";
  $("#deleteNetworkBoxBtn").classList.toggle("hidden", !box);
  $("#networkBoxDialog").showModal();
}

async function saveNetworkBox(e) {
  e.preventDefault();
  if (!currentUser) return;
  const btn = $("#saveNetworkBoxBtn");
  btn.disabled = true;
  btn.textContent = "Guardando...";
  try {
    const id = $("#networkBoxId").value;
    const name = $("#networkBoxName").value.trim();
    const code = $("#networkBoxCode").value.trim();
    const capacity = Number($("#networkBoxCapacity").value);
    const latitude = Number($("#networkBoxLatitude").value);
    const longitude = Number($("#networkBoxLongitude").value);
    if (!name) throw new Error("Escribe el nombre de la caja.");
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 512) throw new Error("La capacidad debe ser un número entero entre 1 y 512.");
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error("Captura coordenadas válidas.");
    const existing = id ? networkBoxes.find(b => b.id === id) : null;
    const connected = existing ? networkBoxClients(id) : [];
    if (connected.some(c => Number(c.networkPort) > capacity)) throw new Error("No puedes reducir la capacidad porque hay clientes conectados en puertos superiores.");
    const refDoc = id ? doc(db, "users", currentUser.uid, "assets", id) : doc(collection(db, "users", currentUser.uid, "assets"));
    await setDoc(refDoc, {
      type: "networkBox", name, code, capacity,
      status: $("#networkBoxStatus").value,
      address: $("#networkBoxAddress").value.trim(),
      latitude, longitude,
      notes: $("#networkBoxNotes").value.trim(),
      updatedAt: serverTimestamp(),
      ...(existing ? {} : { createdAt: serverTimestamp() })
    }, { merge: true });
    selectedNetworkBoxId = refDoc.id;
    $("#networkBoxDialog").close();
    toast(id ? "Caja actualizada correctamente." : "Caja creada correctamente.");
  } catch (err) {
    console.error("ERROR CAJA DE RED:", err);
    toast(friendlyError(err), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar caja";
  }
}

async function deleteSelectedNetworkBox() {
  const id = $("#networkBoxId").value;
  if (!id || !currentUser) return;
  if (networkBoxClients(id).length) {
    toast("No se puede eliminar una caja que todavía tiene clientes conectados. Primero reasigna esos clientes.", "error");
    return;
  }
  if (!confirm("¿Eliminar esta caja de red? Esta acción no se puede deshacer.")) return;
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "assets", id));
    if (selectedNetworkBoxId === id) selectedNetworkBoxId = "";
    $("#networkBoxDialog").close();
    toast("Caja eliminada.");
  } catch (err) {
    console.error("ERROR ELIMINANDO CAJA:", err);
    toast(friendlyError(err), "error");
  }
}

async function seedNetworkExamples() {
  if (!currentUser) return;
  if (networkBoxes.length) {
    toast("Ya tienes cajas registradas. Los ejemplos no se agregaron.", "error");
    return;
  }
  const examples = [
    { name: "Caja Principal", code: "CTO-001", capacity: 8, status: "active", latitude: 19.4326, longitude: -99.1332, address: "Ejemplo de ubicación", notes: "Caja de demostración" },
    { name: "Caja Norte", code: "CTO-002", capacity: 16, status: "active", latitude: 19.4380, longitude: -99.1260, address: "Ejemplo de ubicación", notes: "Segunda caja de demostración" },
    { name: "Caja Sur", code: "CTO-003", capacity: 8, status: "maintenance", latitude: 19.4255, longitude: -99.1390, address: "Ejemplo de ubicación", notes: "Ejemplo en mantenimiento" }
  ];
  try {
    showLoading(true);
    for (const item of examples) {
      const r = doc(collection(db, "users", currentUser.uid, "assets"));
      await setDoc(r, { ...item, type: "networkBox", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    toast("Se agregaron 3 cajas de ejemplo.");
  } catch (err) {
    console.error("ERROR EJEMPLOS RED:", err);
    toast(friendlyError(err), "error");
  } finally {
    showLoading(false);
  }
}

$("#addNetworkBoxBtn")?.addEventListener("click", () => openNetworkBoxDialog());
$("#seedNetworkExamplesBtn")?.addEventListener("click", seedNetworkExamples);
$("#networkBoxForm")?.addEventListener("submit", saveNetworkBox);
$("#deleteNetworkBoxBtn")?.addEventListener("click", deleteSelectedNetworkBox);
$("#networkBoxUseLocationBtn")?.addEventListener("click", () => useBrowserLocation("#networkBoxLatitude", "#networkBoxLongitude"));

$("#networkBoxesList")?.addEventListener("click", e => {
  const item = e.target.closest("[data-network-box]");
  if (!item) return;
  selectedNetworkBoxId = item.dataset.networkBox;
  renderNetwork();
  const box = networkBoxes.find(b => b.id === selectedNetworkBoxId);
  if (box && networkMap && Number.isFinite(Number(box.latitude)) && Number.isFinite(Number(box.longitude))) networkMap.setView([Number(box.latitude), Number(box.longitude)], Math.max(networkMap.getZoom(), 16));
});

$("#networkBoxDetail")?.addEventListener("click", e => {
  const edit = e.target.closest("[data-edit-network-box]");
  if (edit) {
    const box = networkBoxes.find(b => b.id === edit.dataset.editNetworkBox);
    if (box) openNetworkBoxDialog(box);
    return;
  }
  const focus = e.target.closest("[data-focus-client]");
  if (focus) {
    const client = clients.find(c => c.id === focus.dataset.focusClient);
    if (client && networkMap && Number.isFinite(Number(client.latitude)) && Number.isFinite(Number(client.longitude))) {
      networkMap.setView([Number(client.latitude), Number(client.longitude)], 17);
      L.popup().setLatLng([Number(client.latitude), Number(client.longitude)]).setContent(`<strong>${escapeHtml(client.name)}</strong>`).openOn(networkMap);
    } else if (client) toast("Este cliente todavía no tiene coordenadas.", "error");
  }
});

$("#clientNetworkBox")?.addEventListener("change", e => {
  const box = networkBoxes.find(b => b.id === e.target.value);
  const port = $("#clientNetworkPort");
  if (!box) { port.removeAttribute("max"); port.placeholder = "Ej. 1"; return; }
  port.max = Number(box.capacity || 0);
  port.placeholder = `1 a ${Number(box.capacity || 0)}`;
});

const _goSectionOriginal = goSection;
goSection = function(name) {
  _goSectionOriginal(name);
  if (name === "network") initNetworkMap();
};
