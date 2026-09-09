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
  serverTimestamp
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

      const url =
        await uploadImage(
          file,
          `users/${currentUser.uid}/profile/avatar`
        );


      await updateDoc(
        doc(
          db,
          "users",
          currentUser.uid
        ),
        {

          photoURL: url,

          updatedAt:
            serverTimestamp()

        }
      );


      profile.photoURL =
        url;


      renderProfile();


      toast(
        "Foto actualizada."
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
