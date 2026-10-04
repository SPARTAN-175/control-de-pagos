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

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js";

import { firebaseConfig } from "../firebase-config.js";



/* =========================================================
   CONFIRMACIÓN CAHESA
========================================================= */
let pendingCahesaConfirm = null;
function confirmCahesa(message, options = {}) {
  const dialog = $("#cahesaConfirmDialog");
  if (!dialog) return Promise.resolve(window.confirm(message));
  $("#cahesaConfirmTitle").textContent = options.title || "Confirmar acción";
  $("#cahesaConfirmMessage").textContent = message;
  $("#cahesaConfirmAccept").textContent = options.confirmText || "Aceptar";
  $("#cahesaConfirmCancel").textContent = options.cancelText || "Cancelar";
  $("#cahesaConfirmAccept").classList.toggle("danger-button", options.danger !== false);
  return new Promise(resolve => {
    pendingCahesaConfirm = resolve;
    dialog.showModal();
  });
}
function finishCahesaConfirm(result) {
  const resolve = pendingCahesaConfirm;
  pendingCahesaConfirm = null;
  const dialog = $("#cahesaConfirmDialog");
  if (dialog?.open) dialog.close();
  if (resolve) resolve(Boolean(result));
}

/* =========================================================
   FIREBASE
========================================================= */

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app, "us-central1");


/* =========================================================
   HELPERS
========================================================= */

const $ = (s) => document.querySelector(s);

const $$ = (s) => [...document.querySelectorAll(s)];

let currentUser = null;

// CAHESA requiere una cuenta autenticada real. Una sesión anónima
// no cuenta como sesión administrativa.
function isCahesaAuthenticatedUser(user = currentUser) {
  return Boolean(user && user.isAnonymous !== true);
}

let profile = {};
let clients = [];
let payments = [];
let networkBoxes = [];
let networkLocalities = [];

let unsubClients = null;
let unsubPayments = null;
let unsubNetworkBoxes = null;
let unsubConnectors = null;
let unsubMikrotikSnapshot = null;
let activeConnectorId = "";
let activeMikrotikSnapshot = null;

let networkMap = null;
let networkSatelliteLayer = null;
let networkStreetLayer = null;
let networkMapMode = "map";
let networkSatelliteOn = false;
let networkMarkersLayer = null;
let selectedNetworkBoxId = "";
let pendingNetworkMapPlacement = null;

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


const monthKey = (d = new Date()) => {
  const date = d instanceof Date ? d : dateFromIso(d) || new Date(d);
  const safe = Number.isNaN(date?.getTime?.()) ? new Date() : date;
  return `${safe.getFullYear()}-${String(safe.getMonth() + 1).padStart(2, "0")}`;
};


const dateFromIso = (value) => {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};


const addMonths = (value, count = 1) => {
  const source = value instanceof Date ? value : dateFromIso(value);
  if (!source || Number.isNaN(source.getTime())) return "";
  const day = source.getDate();
  const result = new Date(source.getFullYear(), source.getMonth() + count, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return isoDate(result);
};


const timestampDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};


function getPaymentDay(client) {
  const n = Number(client?.paymentDay);
  if (Number.isInteger(n) && n >= 1 && n <= 31) return n;
  const d = dateFromIso(effectiveDueDate(client) || client?.dueDate);
  return d ? d.getDate() : new Date().getDate();
}
function nextDueForPaymentDay(day, fromDate = new Date()) {
  const n = Math.min(31, Math.max(1, Number(day) || fromDate.getDate()));
  const next = new Date(fromDate.getFullYear(), fromDate.getMonth()+1, 1);
  const last = new Date(next.getFullYear(), next.getMonth()+1, 0).getDate();
  return isoDate(new Date(next.getFullYear(), next.getMonth(), Math.min(n,last)));
}
function networkBoxLabel(id) {
  const b = networkBoxes.find(x => x.id === id);
  return b ? (b.code || b.name || id) : (id || "");
}

function effectiveDueDate(client) {
  // Regla de negocio: después de un pago, el siguiente vencimiento
  // siempre es la misma fecha del mes siguiente.
  if (client?.lastPaymentDate) return addMonths(client.lastPaymentDate, 1);
  return client?.dueDate || "";
}


function paymentMonthsForCalendar(payment) {
  if (Array.isArray(payment?.coveredMonths) && payment.coveredMonths.length) {
    return payment.coveredMonths;
  }
  return payment?.month ? [payment.month] : [];
}


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

const CLIENT_CSV_HEADERS = ["ID","Nombre","Teléfono","Correo","PPPoE","Dirección","Servicio","Plan (Mbps)","Mensualidad","Fecha de alta","Día de pago","Próximo vencimiento","Estado","NAP","Puerto","Latitud","Longitud","Tipo de equipo","Marca / modelo","Número de serie","MAC","IP del equipo","SSID / Wi-Fi","Notas"];

function clientToCsvRow(c) {
  return [
    c.id||"",c.name||"",c.phone||"",c.email||"",c.pppoe||c.reference||"",c.address||"",
    c.service||"Internet",c.planMbps??"",Number(c.amount)||0,c.serviceStartDate||"",
    getPaymentDay(c),effectiveDueDate(c)||c.dueDate||"",c.currentPaymentStatus||"pending",
    networkBoxLabel(c.networkBoxId),c.networkPort??"",c.latitude??"",c.longitude??"",
    c.equipmentType||"",c.equipmentModel||"",c.equipmentSerial||"",c.equipmentMac||"",
    c.equipmentIp||"",c.equipmentSsid||"",c.notes||""
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

async function importClientsCsv(file){
  if(!currentUser)throw new Error("Tu sesión no está activa.");
  const ext=String(file.name||"").toLowerCase().split(".").pop(); let rows=[];
  if(ext==="xlsx"||ext==="xls"){const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:""}).map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[normalizeText(k),String(v??"")])))}else rows=csvToObjects(await file.text());
  if(!rows.length)throw new Error("El archivo no contiene registros.");
  const normalized=rows.map(r=>({id:r.id?.trim()||"",name:r.nombre?.trim()||"",phone:r.telefono?.trim()||"",email:r.correo?.trim()||"",pppoe:r.pppoe?.trim()||"",address:r.direccion?.trim()||"",service:r.servicio?.trim()||"Internet",planMbps:Number(String(r.planmbps||"").replace(/[^0-9.]/g,""))||null,amount:Number(String(r.mensualidad||"0").replace(/[$,\s]/g,""))||0,serviceStartDate:r.fechadealta?.trim()||isoDate(),paymentDay:Math.min(31,Math.max(1,Number(r.díadepago||r.diadepago||1)||1)),dueDate:r.proximovencimiento?.trim()||"",currentPaymentStatus:["paid","pagado"].includes((r.estado||"").trim().toLowerCase())?"paid":"pending",nap:r.nap?.trim()||"",networkPort:Number(r.puerto)||null,latitude:r.latitud===""?null:Number(r.latitud),longitude:r.longitud===""?null:Number(r.longitud),equipmentType:r.tipodeequipo?.trim()||"ONU",equipmentModel:r.marcamodelo?.trim()||"",equipmentSerial:r.númerodeserie?.trim()||r.numerodeserie?.trim()||"",equipmentMac:r.mac?.trim()||"",equipmentIp:r.ipdelequipo?.trim()||"",equipmentSsid:r.ssidwifi?.trim()||"",notes:r.notas?.trim()||""})).filter(r=>r.name);
  if(!normalized.length)throw new Error("No encontré filas con nombre de cliente.");
  let created=0,updated=0;
  for(let start=0;start<normalized.length;start+=450){
    const batch=writeBatch(db);
    for(const r of normalized.slice(start,start+450)){
      let existing=r.id?clients.find(c=>c.id===r.id):null;if(!existing)existing=clients.find(c=>normalizeText(c.name)===normalizeText(r.name))||null;
      let boxId=existing?.networkBoxId||"";if(r.nap){const b=networkBoxes.find(x=>x.id===r.nap||normalizeText(x.code||"")===normalizeText(r.nap)||normalizeText(x.name||"")===normalizeText(r.nap));if(!b)throw new Error(`No encontré el NAP "${r.nap}" para "${r.name}".`);boxId=b.id}
      const refDoc=existing?doc(db,"users",currentUser.uid,"clients",existing.id):doc(collection(db,"users",currentUser.uid,"clients"));
      const data={name:r.name,phone:r.phone,email:r.email,pppoe:r.pppoe,reference:existing?.reference||"",address:r.address,service:r.service,planMbps:r.planMbps,amount:r.amount,serviceStartDate:r.serviceStartDate,paymentDay:r.paymentDay,dueDate:r.dueDate||nextDueForPaymentDay(r.paymentDay,new Date()),currentPaymentStatus:r.currentPaymentStatus,networkBoxId:boxId,networkPort:r.networkPort,latitude:Number.isFinite(r.latitude)?r.latitude:null,longitude:Number.isFinite(r.longitude)?r.longitude:null,equipmentType:r.equipmentType,equipmentModel:r.equipmentModel,equipmentSerial:r.equipmentSerial,equipmentMac:r.equipmentMac,equipmentIp:r.equipmentIp,equipmentSsid:r.equipmentSsid,notes:r.notes,active:existing?.active!==false,updatedAt:serverTimestamp()};
      if(!existing){data.createdAt=serverTimestamp();created++}else updated++;batch.set(refDoc,data,{merge:true});
    }await batch.commit();
  }toast(`Importación terminada: ${created} nuevos, ${updated} actualizados.`);
}
function exportClientsExcel(){const rows=clients.map(c=>({"ID":c.id||"","Nombre":c.name||"","Teléfono":c.phone||"","Correo":c.email||"","PPPoE":c.pppoe||c.reference||"","Dirección":c.address||"","Servicio":c.service||"Internet","Plan (Mbps)":c.planMbps??"","Mensualidad":Number(c.amount)||0,"Fecha de alta":c.serviceStartDate||"","Día de pago":getPaymentDay(c),"Próximo vencimiento":effectiveDueDate(c)||c.dueDate||"","Estado":c.currentPaymentStatus||"pending","NAP":networkBoxLabel(c.networkBoxId),"Puerto":c.networkPort??"","Latitud":c.latitude??"","Longitud":c.longitude??"","Tipo de equipo":c.equipmentType||"","Marca / modelo":c.equipmentModel||"","Número de serie":c.equipmentSerial||"","MAC":c.equipmentMac||"","IP del equipo":c.equipmentIp||"","SSID / Wi-Fi":c.equipmentSsid||"","Notas":c.notes||""}));const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{}]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Clientes");XLSX.writeFile(wb,`clientes-cahesa-${isoDate()}.xlsx`)}
function downloadClientTemplateExcel(){const ws=XLSX.utils.aoa_to_sheet([CLIENT_CSV_HEADERS]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Clientes");XLSX.writeFile(wb,"plantilla-clientes-cahesa.xlsx")}

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
   BLOQUEO ADMINISTRATIVO DE CAHESA

   Ninguna acción del área privada puede ejecutarse sin una sesión
   administrativa válida, incluso si el navegador conserva una vista
   anterior o el usuario interactúa antes del callback de Authentication.
========================================================= */
document.addEventListener("click", event => {
  const appView = document.getElementById("appView");
  if (!appView || !appView.contains(event.target)) return;
  if (isCahesaAuthenticatedUser()) return;

  event.preventDefault();
  event.stopPropagation();
  setAppVisible(false);
  toast("Debes iniciar sesión para administrar CAHESA.", "error");
}, true);

/* También bloqueamos formularios privados como última barrera del lado del cliente. */
document.addEventListener("submit", event => {
  const appView = document.getElementById("appView");
  if (!appView || !appView.contains(event.target)) return;
  if (isCahesaAuthenticatedUser()) return;

  event.preventDefault();
  event.stopPropagation();
  setAppVisible(false);
  toast("Debes iniciar sesión para administrar CAHESA.", "error");
}, true);

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

    if (!user || user.isAnonymous) {

      currentUser = null;

      if (unsubClients)
        unsubClients();

      if (unsubPayments)
        unsubPayments();

      if (unsubNetworkBoxes)
        unsubNetworkBoxes();

      if (unsubConnectors)
        unsubConnectors();

      if (unsubMikrotikSnapshot)
        unsubMikrotikSnapshot();

      networkBoxes = [];
      activeConnectorId = "";
      activeMikrotikSnapshot = null;
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

  if (unsubConnectors)
    unsubConnectors();

  if (unsubMikrotikSnapshot)
    unsubMikrotikSnapshot();


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
      const assets = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      networkBoxes = assets
        .filter(item => item.type === "networkBox")
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
      networkLocalities = assets
        .filter(item => item.type === "networkLocality")
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
      renderAll();
    },
    err => { console.error("ERROR CAJAS DE RED:", err); toast(friendlyError(err), "error"); }
  );

  subscribeConnectors();
  }

  
function formatConnectorDate(value) {
  if (!value) return "—";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function escapeTable(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function renderMikrotikPanel() {
  const connectorBadge = $("#connectorStatusBadge");
  const overall = $("#mikrotikOverallStatus");
  const meta = $("#connectorMeta");
  const stats = $("#mikrotikStats");
  const table = $("#mikrotikClientsTable");
  if (!connectorBadge || !overall || !meta || !stats || !table) return;
  const connected = Boolean(activeConnectorId);
  const snapshot = activeMikrotikSnapshot || {};
  const connector = snapshot.__connector || {};
  const lastSeen = connector.lastSeenAt?.toDate ? connector.lastSeenAt.toDate() : (connector.lastSeenAt ? new Date(connector.lastSeenAt) : null);
  const stale = Boolean(lastSeen && (Date.now() - lastSeen.getTime()) > 120000);
  const state = connected && !stale ? "online" : connected ? "stale" : "pending";
  connectorBadge.className = `connector-status ${state}`;
  connectorBadge.textContent = connected ? (stale ? "Sin reporte reciente" : "Conectado") : "No vinculado";
  overall.className = `connector-status ${state}`;
  overall.textContent = connected ? (stale ? "Conector sin reporte" : "En línea") : "Sin conectar";
  meta.innerHTML = `<div><span>Conector</span><strong>${escapeTable(connector.name || connector.id || "—")}</strong></div><div><span>Último reporte</span><strong>${escapeTable(formatConnectorDate(connector.lastSeenAt))}</strong></div><div><span>MikroTik</span><strong>${escapeTable(snapshot.identity || "—")}</strong></div>`;
  const secrets = Number(snapshot.pppSecrets ?? snapshot.clients?.length ?? 0);
  const enabled = Number(snapshot.enabled ?? 0);
  const disabled = Number(snapshot.disabled ?? 0);
  const active = Number(snapshot.active ?? 0);
  stats.innerHTML = `<div><strong>${secrets}</strong><span>PPP Secrets</span></div><div><strong>${enabled}</strong><span>Habilitados</span></div><div><strong>${disabled}</strong><span>Suspendidos</span></div><div><strong>${active}</strong><span>Activos</span></div>`;
  const search = String($("#mikrotikClientSearch")?.value || "").trim().toLowerCase();
  const rows = Array.isArray(snapshot.clients) ? snapshot.clients.filter(c => !search || [c.name,c.secret,c.profile,c.comment,c.address,c.status].some(v => String(v ?? "").toLowerCase().includes(search))) : [];
  if (!rows.length) { table.innerHTML = `<div class="empty-state">${connected ? "No hay clientes que coincidan con la búsqueda." : "Vincula un conector para consultar los clientes reales."}</div>`; return; }
  table.innerHTML = `<table class="mikrotik-table"><thead><tr><th>PPPoE / Secret</th><th>Cliente</th><th>Perfil</th><th>Estado</th><th>IP</th></tr></thead><tbody>${rows.map(c => `<tr><td><strong>${escapeTable(c.secret || c.name || "—")}</strong></td><td>${escapeTable(c.comment || c.name || "—")}</td><td>${escapeTable(c.profile || "—")}</td><td><span class="mikrotik-state ${String(c.status).toLowerCase() === "online" ? "online" : String(c.status).toLowerCase() === "disabled" ? "disabled" : "offline"}">${escapeTable(c.status || "OFFLINE")}</span></td><td>${escapeTable(c.address || c.remoteAddress || "—")}</td></tr>`).join("")}</tbody></table>`;
}

function subscribeConnectors() {
  if (!currentUser) return;
  const connectorsRef = collection(db, "users", currentUser.uid, "connectors");
  unsubConnectors = onSnapshot(connectorsRef, snapshot => {
    if (unsubMikrotikSnapshot) unsubMikrotikSnapshot();
    activeConnectorId = ""; activeMikrotikSnapshot = null;
    const first = snapshot.docs[0];
    if (!first) { renderMikrotikPanel(); return; }
    activeConnectorId = first.id;
    const connectorData = { id: first.id, ...first.data() };
    const snapRef = doc(db, "users", currentUser.uid, "connectors", first.id, "snapshots", "latest");
    unsubMikrotikSnapshot = onSnapshot(snapRef, snap => {
      activeMikrotikSnapshot = snap.exists() ? { ...snap.data(), __connector: connectorData } : { __connector: connectorData };
      renderMikrotikPanel();
    }, err => { console.error("ERROR SNAPSHOT MIKROTIK:", err); activeMikrotikSnapshot = { __connector: connectorData }; renderMikrotikPanel(); });
  }, err => { console.error("ERROR CONECTORES:", err); renderMikrotikPanel(); });
}

async function importMikrotikClientsToClients() {
  if (!currentUser || !isCahesaAuthenticatedUser()) return;

  const snapshot = activeMikrotikSnapshot || {};
  const sourceClients = Array.isArray(snapshot.clients) ? snapshot.clients : [];
  if (!sourceClients.length) {
    toast("Primero espera a que el Connector reporte los clientes del MikroTik.", "error");
    return;
  }

  const button = $("#importMikrotikClientsBtn");
  try {
    button.disabled = true;
    button.textContent = "Pasando…";
    showLoading(true);

    const existingBySecret = new Map();
    clients.forEach(client => {
      const secret = String(client.mikrotikSecret || client.pppoeSecret || client.reference || "").trim();
      if (secret && !existingBySecret.has(secret)) existingBySecret.set(secret, client);
    });

    const batch = writeBatch(db);
    let created = 0;
    let updated = 0;

    sourceClients.slice(0, 500).forEach(source => {
      const secret = String(source.secret || source.name || "").trim();
      if (!secret) return;

      const existing = existingBySecret.get(secret);
      const technicalData = {
        mikrotikSecret: secret,
        pppoeSecret: secret,
        mikrotikProfile: String(source.profile || "").trim(),
        mikrotikStatus: String(source.status || "OFFLINE").trim(),
        mikrotikAddress: String(source.address || source.remoteAddress || "").trim(),
        mikrotikUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      if (existing) {
        batch.set(
          doc(db, "users", currentUser.uid, "clients", existing.id),
          technicalData,
          { merge: true }
        );
        updated++;
        return;
      }

      const clientRef = doc(collection(db, "users", currentUser.uid, "clients"));
      const importedName = String(source.comment || source.name || secret).trim() || secret;
      batch.set(clientRef, {
        name: importedName,
        phone: "",
        reference: secret,
        address: "",
        service: "Internet",
        amount: 0,
        dueDate: addMonths(isoDate(), 1),
        currentPaymentStatus: "pending",
        notes: "Cliente importado desde MikroTik. Completa sus datos comerciales.",
        photoURL: "",
        active: true,
        createdAt: serverTimestamp(),
        ...technicalData,
        mikrotikImportedAt: serverTimestamp()
      });
      created++;
    });

    if (!created && !updated) {
      toast("No hubo clientes nuevos para sincronizar.");
      return;
    }

    await batch.commit();
    toast(`${created} clientes agregados y ${updated} clientes actualizados desde MikroTik.`);
  } catch (err) {
    console.error("ERROR IMPORTANDO CLIENTES MIKROTIK:", err);
    toast(friendlyError(err), "error");
  } finally {
    showLoading(false);
    button.disabled = false;
    button.textContent = "Pasar a mis clientes";
  }
}

async function createConnectorPairing() {
  if (!currentUser || !isCahesaAuthenticatedUser()) return;
  const button = $("#createConnectorPairingBtn");
  try {
    button.disabled = true; button.textContent = "Generando…";
    const callable = httpsCallable(functions, "createConnectorPairing");
    const result = await callable({});
    const code = result.data?.code;
    if (!code) throw new Error("El servidor no devolvió un código de vinculación.");
    $("#pairingCodeValue").textContent = code;
    $("#pairingCodeBox").classList.remove("hidden");
    toast("Código de vinculación generado. Caduca en 10 minutos y solo puede utilizarse una vez.");
  } catch (err) { console.error("ERROR GENERANDO VINCULACIÓN:", err); toast(friendlyError(err), "error"); }
  finally { button.disabled = false; button.textContent = "Generar código de vinculación"; }
}

$("#createConnectorPairingBtn")?.addEventListener("click", createConnectorPairing);
$("#refreshMikrotikBtn")?.addEventListener("click", renderMikrotikPanel);
$("#importMikrotikClientsBtn")?.addEventListener("click", importMikrotikClientsToClients);
$("#mikrotikClientSearch")?.addEventListener("input", renderMikrotikPanel);


  
/* =========================================================
   ESTADO DEL CLIENTE
========================================================= */

function clientStatus(c) {

  if (getClientOverdueMonths(c).length)
    return "overdue";


  if (
    c.currentPaymentStatus === "paid"
  )
    return "paid";


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
  renderPaymentCalendar();
  renderNetwork();
  renderMikrotikPanel();

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
            effectiveDueDate(c) || "—"
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
  const q=($("#clientSearch")?.value||"").toLowerCase().trim(), f=$("#clientFilter")?.value||"all";
  const arr=clients.filter(c=>(!q||`${c.name} ${c.phone||""} ${c.pppoe||c.reference||""}`.toLowerCase().includes(q))&&(f==="all"||clientStatus(c)===f));
  $("#clientsGrid").className=arr.length?"clients-grid":"clients-grid empty-state";
  $("#clientsGrid").innerHTML=arr.length?arr.map(c=>`
    <article class="client-card">
      <div class="client-cover"><img src="${escapeHtml(c.photoURL||"img/perfil.jpg")}" alt=""><span class="badge ${clientStatus(c)}">${statusLabel(clientStatus(c))}</span></div>
      <div class="client-body">
        <h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.service||"Internet")} · ${money(c.amount)}/mes</p>
        <div class="client-meta">
          <span>📆 Día de pago: <strong>${getPaymentDay(c)}</strong></span>
          <span>📅 Vence: ${escapeHtml(effectiveDueDate(c)||"—")}</span>
          <span>📡 PPPoE: ${escapeHtml(c.pppoe||c.reference||"—")}</span>
          <span>📍 ${escapeHtml(networkBoxLabel(c.networkBoxId)||"Sin NAP")}${c.networkPort?` · Puerto ${Number(c.networkPort)}`:""}</span>
        </div>
        <div class="card-actions">
          <button class="ghost" data-history-client="${escapeHtml(c.id)}">Historial</button>
          <button class="ghost" data-edit="${escapeHtml(c.id)}">Editar</button>
          <button class="danger-button small" data-delete-client="${escapeHtml(c.id)}">Eliminar</button>
          <button class="primary" data-pay="${escapeHtml(c.id)}">Registrar pago</button>
        </div>
      </div>
    </article>`).join(""):"No hay clientes que coincidan con el filtro.";
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
  const q=($("#historySearch")?.value||"").toLowerCase().trim(), m=$("#historyMonth")?.value||"";
  const arr=payments.filter(p=>(!q||(p.clientName||"").toLowerCase().includes(q))&&(!m||p.month===m));
  $("#historyList").className=arr.length?"history-list":"history-list empty-state";
  $("#historyList").innerHTML=arr.length?arr.map(p=>`<button type="button" class="history-row history-clickable" data-history-client="${escapeHtml(p.clientId||"")}"><div><strong>${escapeHtml(p.clientName||"Cliente eliminado")}</strong><span>${escapeHtml(p.method||"Efectivo")} · ${escapeHtml(p.paidDate||"")} · Folio ${escapeHtml(p.receiptNumber||p.id||"")}</span></div><strong class="amount-positive">${money(p.amount)}</strong></button>`).join(""):"No hay pagos registrados.";
  const orphan=payments.filter(p=>!clients.some(c=>c.id===p.clientId)), box=$("#orphanHistoryList");
  if(box) box.innerHTML=orphan.length?orphan.map(p=>`<div class="history-row"><div><strong>${escapeHtml(p.clientName||"Cliente eliminado")}</strong><span>${escapeHtml(p.paidDate||"")} · ${money(p.amount)}</span></div><button class="danger-button small" data-delete-history="${escapeHtml(p.id)}">Borrar historial</button></div>`).join(""):`<div class="empty-state">No hay historiales conservados de clientes eliminados.</div>`;
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
  $("#clientDialogTitle").textContent=c?"Editar cliente":"Nuevo cliente";
  $("#clientId").value=c?.id||""; $("#clientName").value=c?.name||""; $("#clientPhone").value=c?.phone||"";
  $("#clientEmail").value=c?.email||""; $("#clientPppoe").value=c?.pppoe||c?.reference||""; $("#clientAddress").value=c?.address||"";
  populateClientNetworkSelect(); $("#clientNetworkBox").value=c?.networkBoxId||""; $("#clientNetworkPort").value=c?.networkPort??"";
  $("#clientLatitude").value=c?.latitude??""; $("#clientLongitude").value=c?.longitude??"";
  $("#clientEquipmentType").value=c?.equipmentType||"ONU"; $("#clientEquipmentModel").value=c?.equipmentModel||"";
  $("#clientEquipmentSerial").value=c?.equipmentSerial||""; $("#clientEquipmentMac").value=c?.equipmentMac||"";
  $("#clientEquipmentIp").value=c?.equipmentIp||""; $("#clientEquipmentSsid").value=c?.equipmentSsid||"";
  $("#clientService").value=c?.service||"Internet"; $("#clientPlanMbps").value=c?.planMbps??""; $("#clientAmount").value=c?.amount??100;
  $("#clientStartDate").value=c?.serviceStartDate||(timestampDate(c?.createdAt)?isoDate(timestampDate(c.createdAt)):isoDate()); $("#clientPaymentDay").value=getPaymentDay(c||{});
  $("#clientDueDate").value=effectiveDueDate(c)||c?.dueDate||nextDueForPaymentDay(getPaymentDay({}),new Date());
  $("#clientStatus").value=c?.currentPaymentStatus||"pending"; $("#clientNotes").value=c?.notes||""; $("#clientPhoto").value="";
  $("#deleteClientBtn")?.classList.toggle("hidden",!c); $("#clientDialog").showModal();
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

let clientLocationMap=null, clientLocationMarker=null;
function openClientLocationPicker(){
  const d=$("#clientLocationDialog");if(!d)return;const lat=Number($("#clientLatitude").value),lng=Number($("#clientLongitude").value),center=Number.isFinite(lat)&&Number.isFinite(lng)?[lat,lng]:[17.2208,-93.3808];
  d.showModal();setTimeout(()=>{if(!clientLocationMap){clientLocationMap=L.map("clientLocationMap").setView(center,16);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(clientLocationMap);clientLocationMarker=L.marker(center).addTo(clientLocationMap);clientLocationMap.on("move",()=>clientLocationMarker.setLatLng(clientLocationMap.getCenter()))}else{clientLocationMap.setView(center,16);clientLocationMarker.setLatLng(center)}clientLocationMap.invalidateSize()},80)
}
$("#clientPickMapBtn")?.addEventListener("click",openClientLocationPicker);
$("#confirmClientLocationBtn")?.addEventListener("click",()=>{if(!clientLocationMap)return;const c=clientLocationMap.getCenter();$("#clientLatitude").value=c.lat.toFixed(7);$("#clientLongitude").value=c.lng.toFixed(7);$("#clientLocationDialog").close();toast("Ubicación seleccionada en el mapa.")});
$("#clientUseLocationBtn")?.addEventListener("click", () => useBrowserLocation("#clientLatitude", "#clientLongitude"));
$("#deleteClientBtn")?.addEventListener("click", () => deleteClient($("#clientId").value));


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


      const paymentDay = Number($("#clientPaymentDay").value);
      const serviceStartDate = $("#clientStartDate").value;
      const dueDate = nextDueForPaymentDay(paymentDay, new Date());


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


      if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) throw new Error("El día de pago debe estar entre 1 y 31.");
      if (!serviceStartDate) throw new Error("Selecciona la fecha de alta del servicio.");

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

        email:
          $("#clientEmail")
            .value
            .trim(),

        pppoe:
          $("#clientPppoe")
            .value
            .trim(),

        reference:
          oldClient?.reference || "",

        address:
          $("#clientAddress")
            .value
            .trim(),

        networkBoxId: selectedBoxId,
        networkPort: selectedPort,
        latitude: latitudeValue,
        longitude: longitudeValue,
        equipmentType: $("#clientEquipmentType").value || "ONU",
        equipmentModel: $("#clientEquipmentModel").value.trim(),
        equipmentSerial: $("#clientEquipmentSerial").value.trim(),
        equipmentMac: $("#clientEquipmentMac").value.trim(),
        equipmentIp: $("#clientEquipmentIp").value.trim(),
        equipmentSsid: $("#clientEquipmentSsid").value.trim(),

        service:
          $("#clientService")
            .value
            .trim() ||
          "Internet",

        planMbps: Number($("#clientPlanMbps").value) || null,
        amount,
        serviceStartDate,
        paymentDay,
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


async function deletePaymentHistoryForClient(clientId) {
  const rows=payments.filter(p=>p.clientId===clientId); if(!rows.length)return;
  const batch=writeBatch(db); rows.forEach(p=>batch.delete(doc(db,"users",currentUser.uid,"payments",p.id))); await batch.commit();
}
async function deleteClient(clientId) {
  if(!currentUser||!clientId)return; const client=clients.find(c=>c.id===clientId); if(!client)return;
  const ok=await confirmCahesa(`¿Deseas eliminar a ${client.name||"este cliente"}?\n\nDespués podrás decidir si conservas o eliminas su historial.`,{title:"Eliminar cliente",confirmText:"Continuar",danger:true});
  if(!ok)return;
  const delHistory=await confirmCahesa(`¿También deseas eliminar TODOS sus pagos históricos?\n\nSi eliges «Conservar historial», el cliente desaparecerá pero sus pagos permanecerán disponibles.`,{title:"Historial de pagos",confirmText:"Eliminar historial",cancelText:"Conservar historial",danger:true});
  try{showLoading(true);if(delHistory)await deletePaymentHistoryForClient(clientId);await deleteDoc(doc(db,"users",currentUser.uid,"clients",clientId));if($("#clientDialog")?.open)$("#clientDialog").close();toast(delHistory?"Cliente e historial eliminados.":"Cliente eliminado. Su historial fue conservado.");}
  catch(err){console.error(err);toast(friendlyError(err),"error")}finally{showLoading(false)}
}
/* =========================================================
   MENSUALIDADES / CALENDARIO
========================================================= */

function monthLabel(key, short = false) {
  const [y, m] = String(key).split("-").map(Number);
  if (!y || !m) return key || "";
  return new Intl.DateTimeFormat("es-MX", {
    month: short ? "short" : "long",
    year: "numeric"
  }).format(new Date(y, m - 1, 1));
}


function monthDayDueDate(month, day) {
  const [y, m] = String(month).split("-").map(Number);
  if (!y || !m) return "";
  const lastDay = new Date(y, m, 0).getDate();
  const d = new Date(y, m - 1, Math.min(Number(day) || 1, lastDay));
  return isoDate(d);
}


function getClientPaymentMonths(clientId) {
  const result = new Set();
  payments
    .filter(p => p.clientId === clientId)
    .forEach(p => paymentMonthsForCalendar(p).forEach(m => result.add(m)));
  return result;
}


function getClientOverdueMonths(client) {
  const due = effectiveDueDate(client);
  const todayIso = isoDate();
  const today = dateFromIso(todayIso);
  if (!due || !today) return [];

  const dueDate = dateFromIso(due);
  if (!dueDate) return [];

  const paid = getClientPaymentMonths(client.id);
  const created = timestampDate(client.createdAt);
  const paymentDates = payments
    .filter(p => p.clientId === client.id && p.paidDate)
    .map(p => dateFromIso(p.paidDate))
    .filter(Boolean);

  let start = new Date(dueDate.getFullYear(), dueDate.getMonth(), 1);
  const knownDates = [created, ...paymentDates].filter(Boolean);
  if (knownDates.length) {
    const earliest = new Date(Math.min(...knownDates.map(d => d.getTime())));
    const earliestMonth = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
    if (earliestMonth < start) start = earliestMonth;
  }

  const end = new Date(today.getFullYear(), today.getMonth(), 1);
  const day = dueDate.getDate();
  const overdue = [];

  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
    const key = monthKey(cursor);
    if (paid.has(key)) continue;
    const deadline = monthDayDueDate(key, day);
    if (deadline < todayIso) overdue.push(key);
  }

  return overdue;
}


function renderPaymentOverdueOptions(client) {
  const box = $("#paymentOverdueBox");
  if (!box) return;

  const overdue = getClientOverdueMonths(client);
  box.classList.toggle("hidden", overdue.length === 0);

  if (!overdue.length) {
    box.innerHTML = "";
    return;
  }

  box.innerHTML = `
    <div class="overdue-payment-head">
      <strong>Mensualidades atrasadas</strong>
      <span>Marca la(s) que vas a liquidar con este pago.</span>
    </div>
    <div class="overdue-payment-options">
      ${overdue.map(month => `
        <label class="overdue-payment-option">
          <input type="checkbox" name="paymentCoveredMonth" value="${escapeHtml(month)}">
          <span>${escapeHtml(monthLabel(month))}</span>
        </label>
      `).join("")}
    </div>
  `;
}


function buildPaymentCalendarHtml() {
  const active = clients.filter(c => c.active !== false);
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  // Ventana móvil de 12 meses: 5 meses anteriores + mes actual + 6 siguientes.
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() - 5 + i, 1);
    return monthKey(d);
  });

  if (!active.length) {
    return `<div class="empty-state">Agrega clientes para ver su calendario mensual.</div>`;
  }

  return `
    <div class="payment-calendar-scroll">
      <table class="payment-calendar">
        <thead>
          <tr>
            <th>Cliente</th>
            ${months.map(m => `<th>${escapeHtml(monthLabel(m, true).replace(/\s+de\s+\d{4}/i, ""))}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${active.map(c => {
            const paid = getClientPaymentMonths(c.id);
            const created = timestampDate(c.createdAt);
            const createdMonth = created ? monthKey(created) : "";
            const due = effectiveDueDate(c);
            const dueDate = dateFromIso(due);
            const dueDay = dueDate?.getDate() || 1;
            return `<tr>
              <th class="payment-calendar-client">${escapeHtml(c.name)}</th>
              ${months.map(m => {
                const deadline = monthDayDueDate(m, dueDay);
                const isFuture = m > monthKey(now);
                const beforeClient = createdMonth && m < createdMonth;
                let state = "future";
                let label = "—";
                if (!beforeClient && paid.has(m)) { state = "paid"; label = "✓"; }
                else if (!beforeClient && !isFuture && deadline < isoDate()) { state = "overdue"; label = "!"; }
                else if (!beforeClient && m === monthKey(now)) { state = "pending"; label = "•"; }
                const currentClass = m === monthKey(now) ? " current-month" : "";
                return `<td><span class="payment-month-cell ${state}${currentClass}" title="${escapeHtml(monthLabel(m))}">${label}</span></td>`;
              }).join("")}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <div class="payment-calendar-legend">
      <span><i class="paid"></i> Pagado</span>
      <span><i class="pending"></i> Pendiente</span>
      <span><i class="overdue"></i> Atrasado</span>
      <span><i class="future"></i> Futuro</span>
    </div>
  `;
}

function renderPaymentCalendar() {
  const html = buildPaymentCalendarHtml();
  const host = $("#paymentCalendar");
  const standalone = $("#paymentCalendarStandalone");
  if (host) host.innerHTML = html;
  if (standalone) standalone.innerHTML = html;
}

/* =========================================================
   DIALOGO DE PAGO
========================================================= */

function openClientHistoryDialog(clientId){
  const rows=payments.filter(p=>p.clientId===clientId).sort((a,b)=>String(b.paidDate||"").localeCompare(String(a.paidDate||"")));
  const client=clients.find(c=>c.id===clientId);
  $("#clientHistoryTitle").textContent=client?.name||rows[0]?.clientName||"Historial";
  $("#clientHistorySummary").textContent=`${rows.length} pago${rows.length===1?"":"s"} registrado${rows.length===1?"":"s"}`;
  $("#clientHistoryList").innerHTML=rows.length?rows.map(p=>`<button type="button" class="history-row history-clickable" data-open-receipt='${escapeHtml(JSON.stringify(p))}'><div><strong>${escapeHtml(p.paidDate||"")}</strong><span>${escapeHtml(p.method||"Efectivo")} · Folio ${escapeHtml(p.receiptNumber||p.id)}</span></div><strong class="amount-positive">${money(p.amount)}</strong></button>`).join(""):`<div class="empty-state">Este cliente todavía no tiene pagos.</div>`;
  $("#clientHistoryDialog").showModal();
}
function receiptHtml(p){return `<div class="receipt"><div class="receipt-brand">CAHESA</div><div class="receipt-title">COMPROBANTE DE PAGO</div><div class="receipt-line"><span>Cliente</span><strong>${escapeHtml(p.clientName||"—")}</strong></div><div class="receipt-line"><span>Periodo</span><strong>${escapeHtml(monthLabel(p.month||""))}</strong></div><div class="receipt-line"><span>Fecha de pago</span><strong>${escapeHtml(p.paidDate||"—")}</strong></div><div class="receipt-line"><span>Método</span><strong>${escapeHtml(p.method||"Efectivo")}</strong></div><div class="receipt-total"><span>Total pagado</span><strong>${money(p.amount)}</strong></div>${p.nextDueDate?`<div class="receipt-line"><span>Próximo vencimiento</span><strong>${escapeHtml(p.nextDueDate)}</strong></div>`:""}${p.note?`<div class="receipt-note">${escapeHtml(p.note)}</div>`:""}<div class="receipt-ok">✓ PAGO REGISTRADO</div><small>Comprobante generado por CAHESA</small></div>`}
function receiptShareText(p){return `CAHESA\nCOMPROBANTE DE PAGO\nCliente: ${p.clientName||"—"}\nPeriodo: ${monthLabel(p.month||"")}\nFecha de pago: ${p.paidDate||"—"}\nMonto: ${money(p.amount)}\nMétodo: ${p.method||"Efectivo"}`;}
async function receiptDomToCanvas(p){
  // Generamos el ticket directamente con Canvas. Esto evita foreignObject/SVG,
  // que en algunos navegadores Android falla al convertir HTML a imagen.
  const scale=3;
  const width=900;
  const pad=88;
  const inner=width-pad*2;
  const rows=[];
  rows.push(["Cliente", p.clientName||"—"]);
  rows.push(["Periodo", monthLabel(p.month||"")]);
  rows.push(["Fecha de pago", p.paidDate||"—"]);
  rows.push(["Método", p.method||"Efectivo"]);
  if(p.nextDueDate) rows.push(["Próximo vencimiento", p.nextDueDate]);

  const height=1080 + (p.nextDueDate ? 74 : 0) + (p.note ? 70 : 0);
  const canvas=document.createElement("canvas");
  canvas.width=width*scale;
  canvas.height=height*scale;
  const ctx=canvas.getContext("2d");
  if(!ctx) throw new Error("No se pudo crear el lienzo del comprobante.");
  ctx.scale(scale,scale);
  ctx.fillStyle="#ffffff";
  ctx.fillRect(0,0,width,height);

  const roundRect=(x,y,w,h,r,fill,stroke)=>{
    ctx.beginPath();
    ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill();}
    if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}
  };
  const text=(value,x,y,size,weight="400",color="#111827",align="left")=>{
    ctx.font=`${weight} ${size}px Arial, sans-serif`;
    ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline="middle";
    ctx.fillText(String(value),x,y);
  };
  const line=(y)=>{ctx.strokeStyle="#e5e7eb";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(width-pad,y);ctx.stroke();};

  roundRect(24,24,width-48,height-48,28,"#ffffff","#e5e7eb");
  text("CAHESA",width/2,105,54,"800","#000000","center");
  text("COMPROBANTE DE PAGO",width/2,155,24,"500","#64748b","center");

  let y=220;
  for(const [label,value] of rows){
    text(label,pad,y,28,"400","#111827","left");
    text(value,width-pad,y,28,"800","#111827","right");
    y+=74; line(y-34);
  }

  y+=10;
  text("Total pagado",pad,y,30,"400","#111827","left");
  text(money(p.amount),width-pad,y,38,"800","#111827","right");
  y+=76; line(y-38);

  if(p.note){
    text(p.note,pad,y,22,"400","#64748b","left");
    y+=58;
  }

  text("✓ PAGO REGISTRADO",width/2,y+35,30,"800","#111827","center");
  text("Comprobante generado por CAHESA",width/2,y+88,22,"400","#64748b","center");
  return canvas;
}
function receiptCanvasFile(p){return receiptDomToCanvas(p).then(canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(new File([blob],`ticket-cahesa-${p.paidDate||"pago"}.png`,{type:"image/png"})):reject(new Error("No se pudo generar la imagen.")),"image/png",1)));}
async function openReceiptDialog(p){
  const d=$("#receiptDialog");
  if(!d)return;
  d.dataset.receiptText=receiptShareText(p);
  d.dataset.receiptJson=JSON.stringify(p);
  d._receiptFile=null;
  $("#receiptContent").innerHTML=receiptHtml(p);
  d.showModal();
  const shareBtn=$("#shareReceiptBtn");
  const downloadBtn=$("#downloadReceiptImageBtn");
  shareBtn?.setAttribute("disabled","disabled");
  downloadBtn?.setAttribute("disabled","disabled");
  try{
    d._receiptFile=await receiptCanvasFile(p);
    shareBtn?.removeAttribute("disabled");
    downloadBtn?.removeAttribute("disabled");
  }catch(e){
    console.error("CAHESA: no se pudo preparar el ticket como imagen",e);
    toast("No se pudo preparar el ticket como imagen.","error");
  }
}
function printReceipt(){const content=$("#receiptContent")?.innerHTML||"",w=window.open("","_blank","width=480,height=760");if(!w){toast("El navegador bloqueó la ventana de impresión.","error");return}w.document.write(`<html><head><title>Comprobante CAHESA</title><style>body{font-family:Arial;padding:20px}.receipt{max-width:380px;margin:auto;border:1px solid #ddd;border-radius:16px;padding:22px}.receipt-line,.receipt-total{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #eee}.receipt-total{font-size:20px}.receipt-ok{text-align:center;font-weight:800;margin:18px 0}</style></head><body>${content}</body></html>`);w.document.close();setTimeout(()=>w.print(),150)}
async function shareReceiptImage(){
  const d=$("#receiptDialog");
  const file=d?._receiptFile;
  if(!file){toast("El ticket todavía se está preparando.","error");return;}
  try{
    if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
      // Importante: no hacemos ningún await antes de navigator.share().
      // Android/Chrome puede perder el gesto del usuario si esperamos aquí.
      await navigator.share({title:"Comprobante CAHESA",files:[file]});
      return;
    }
    const url=URL.createObjectURL(file);
    const a=document.createElement("a");
    a.href=url;a.download=file.name;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    toast("Imagen del comprobante guardada. Puedes compartirla en WhatsApp.");
  }catch(e){
    if(e?.name==="AbortError")return;
    console.error("CAHESA: error al compartir ticket",e);
    toast("No fue posible abrir el menú para compartir el ticket.","error");
  }
}
async function downloadReceiptImage(){
  const d=$("#receiptDialog");
  const file=d?._receiptFile;
  if(!file){toast("El ticket todavía se está preparando.","error");return;}
  try{
    const url=URL.createObjectURL(file);
    const a=document.createElement("a");
    a.href=url;a.download=file.name;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    toast("Ticket guardado como imagen.");
  }catch(e){
    console.error("CAHESA: error al guardar ticket",e);
    toast("No fue posible guardar el ticket.","error");
  }
}

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

  renderPaymentOverdueOptions(c);

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


      const overdueBox = $("#paymentOverdueBox");
      const selectedOverdueMonths = overdueBox
        ? [...overdueBox.querySelectorAll('input[name="paymentCoveredMonth"]:checked')].map(input => input.value)
        : [];
      const overdueMonths = getClientOverdueMonths(c);
      const coveredMonths = selectedOverdueMonths.length
        ? selectedOverdueMonths
        : [paidDate.slice(0, 7)];

      if (overdueMonths.length && !selectedOverdueMonths.length) {
        throw new Error("Selecciona al menos una mensualidad atrasada para liquidar.");
      }

      const latestCoveredMonth = coveredMonths.slice().sort().at(-1);
      const billingDay = overdueMonths.length
        ? (dateFromIso(effectiveDueDate(c))?.getDate() || getPaymentDay(c))
        : getPaymentDay(c);
      const latestCoveredDate = latestCoveredMonth
        ? monthDayDueDate(latestCoveredMonth, billingDay)
        : paidDate;
      const nextDueDate = addMonths(latestCoveredDate, 1);


      const receiptNumber = `CAH-${paidDate.replaceAll("-","")}-${String(Date.now()).slice(-6)}`;
      const paymentRef = doc(collection(db,"users",currentUser.uid,"payments"));
      await setDoc(paymentRef, {

          clientId: id,

          clientName: c.name,
          receiptNumber,

          amount,

          paidDate,

          month: paidDate.slice(0, 7),

          coveredMonths,

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

          dueDate:
            nextDueDate,

          updatedAt:
            serverTimestamp()

        }
      );


      $("#paymentDialog").close();
      const currentDay=getPaymentDay(c), paidDay=dateFromIso(paidDate)?.getDate()||currentDay;
      if(paidDay!==currentDay){
        const changeDay=await confirmCahesa(`El día habitual es ${currentDay} y el pago se registró el día ${paidDay}.\n\n¿Deseas establecer el día ${paidDay} como nuevo día de pago?`,{title:"Actualizar día de pago",confirmText:`Cambiar a día ${paidDay}`,cancelText:"Mantener día actual",danger:false});
        if(changeDay){
          const newDue=nextDueForPaymentDay(paidDay,dateFromIso(paidDate)||new Date());
          await updateDoc(doc(db,"users",currentUser.uid,"clients",id),{paymentDay:paidDay,dueDate:newDue,updatedAt:serverTimestamp()});
          c.paymentDay=paidDay;c.dueDate=newDue;
        }
      }
      toast(`Pago de ${money(amount)} registrado.`);
      openReceiptDialog({id:paymentRef.id,receiptNumber,clientId:id,clientName:c.name,amount,paidDate,month:paidDate.slice(0,7),method:$("#paymentMethod").value,note:$("#paymentNote").value.trim(),nextDueDate:c.dueDate||nextDueDate});


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


$("#paymentOverdueBox")?.addEventListener("change", () => {
  const id = $("#paymentClientId")?.value;
  const c = clients.find(x => x.id === id);
  if (!c) return;
  const selected = document.querySelectorAll('#paymentOverdueBox input[name="paymentCoveredMonth"]:checked').length;
  if (selected) $("#paymentAmount").value = (Number(c.amount || 0) * selected).toFixed(2);
});


/* =========================================================
   DATOS / IMÁGENES
========================================================= */

$("#exportClientsBtn")?.addEventListener("click", () => {
  try {
    exportClientsExcel();
    toast("Clientes exportados en formato Excel.");
  } catch (err) {
    console.error("ERROR EXPORTANDO CLIENTES:", err);
    toast(friendlyError(err), "error");
  }
});

$("#downloadClientTemplateBtn")?.addEventListener("click", () => {
  try {
    downloadClientTemplateExcel();
    toast("Plantilla Excel descargada.");
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


async function seedCahesaDemoData(){
  if(!currentUser)throw new Error("Inicia sesión.");
  if(networkBoxes.some(x=>x.demoData)||clients.some(x=>x.demoData)||payments.some(x=>x.demoData))throw new Error("Ya existen datos de ejemplo.");
  const n1=doc(collection(db,"users",currentUser.uid,"assets")),n2=doc(collection(db,"users",currentUser.uid,"assets")),c1=doc(collection(db,"users",currentUser.uid,"clients")),c2=doc(collection(db,"users",currentUser.uid,"clients")),p1=doc(collection(db,"users",currentUser.uid,"payments")),p2=doc(collection(db,"users",currentUser.uid,"payments"));
  const d=isoDate(),day=new Date().getDate(),d2=Math.min(28,day+3),b=writeBatch(db);
  b.set(n1,{type:"networkBox",name:"NAP Centro",code:"NAP-01",locality:"Centro",capacity:8,status:"active",latitude:17.2201,longitude:-93.3811,address:"Zona Centro",notes:"Dato de demostración",demoData:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  b.set(n2,{type:"networkBox",name:"NAP Norte",code:"NAP-02",locality:"Norte",capacity:8,status:"active",latitude:17.2240,longitude:-93.3775,address:"Zona Norte",notes:"Dato de demostración",demoData:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  const cA={name:"Cliente Demo 1",phone:"9320000001",email:"demo1@cahesa.test",pppoe:"demo01",address:"Calle Demo 1",service:"Internet",planMbps:20,amount:300,serviceStartDate:addMonths(d,-6),paymentDay:day,dueDate:nextDueForPaymentDay(day,new Date()),currentPaymentStatus:"paid",networkBoxId:n1.id,networkPort:1,latitude:17.2208,longitude:-93.3808,equipmentType:"ONU",equipmentModel:"Huawei",equipmentSerial:"DEMO-001",equipmentMac:"00:00:00:00:00:01",equipmentIp:"192.168.88.101",equipmentSsid:"CAHESA-DEMO-1",notes:"Cliente de demostración",active:true,demoData:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  const cB={name:"Cliente Demo 2",phone:"9320000002",email:"demo2@cahesa.test",pppoe:"demo02",address:"Calle Demo 2",service:"Internet",planMbps:50,amount:450,serviceStartDate:addMonths(d,-4),paymentDay:d2,dueDate:nextDueForPaymentDay(d2,new Date()),currentPaymentStatus:"pending",networkBoxId:n2.id,networkPort:2,latitude:17.2236,longitude:-93.3772,equipmentType:"ONU",equipmentModel:"VSOL",equipmentSerial:"DEMO-002",equipmentMac:"00:00:00:00:00:02",equipmentIp:"192.168.88.102",equipmentSsid:"CAHESA-DEMO-2",notes:"Cliente de demostración",active:true,demoData:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  b.set(c1,cA);b.set(c2,cB);b.set(p1,{clientId:c1.id,clientName:cA.name,amount:300,paidDate:d,month:monthKey(),coveredMonths:[monthKey()],method:"Efectivo",note:"Pago de demostración",receiptNumber:"CAH-DEMO-001",demoData:true,createdAt:serverTimestamp(),paidAt:serverTimestamp()});b.set(p2,{clientId:c2.id,clientName:cB.name,amount:450,paidDate:addMonths(d,-1),month:monthKey(addMonths(d,-1)),coveredMonths:[monthKey(addMonths(d,-1))],method:"Efectivo",note:"Pago de demostración",receiptNumber:"CAH-DEMO-002",demoData:true,createdAt:serverTimestamp(),paidAt:serverTimestamp()});
  await b.commit();toast("Datos de ejemplo cargados: 2 NAPs, 2 clientes y 2 pagos.");
}
async function clearCahesaDemoData(){
  const items=[...networkBoxes.filter(x=>x.demoData).map(x=>["assets",x.id]),...clients.filter(x=>x.demoData).map(x=>["clients",x.id]),...payments.filter(x=>x.demoData).map(x=>["payments",x.id])];
  if(!items.length){toast("No hay datos de ejemplo.");return}const ok=await confirmCahesa(`Se eliminarán ${items.length} registros de ejemplo. Los datos reales no se tocarán.`,{title:"Limpiar ejemplos",confirmText:"Eliminar ejemplos",danger:true});if(!ok)return;
  const b=writeBatch(db);items.forEach(([col,id])=>b.delete(doc(db,"users",currentUser.uid,col,id)));await b.commit();toast("Datos de ejemplo eliminados.");
}
$("#seedCahesaDemoBtn")?.addEventListener("click",async()=>{try{showLoading(true);await seedCahesaDemoData()}catch(e){toast(friendlyError(e),"error")}finally{showLoading(false)}});
$("#clearCahesaDemoBtn")?.addEventListener("click",async()=>{try{showLoading(true);await clearCahesaDemoData()}catch(e){toast(friendlyError(e),"error")}finally{showLoading(false)}});
$("#printReceiptBtn")?.addEventListener("click",printReceipt);$("#shareReceiptBtn")?.addEventListener("click",shareReceiptImage);$("#downloadReceiptImageBtn")?.addEventListener("click",downloadReceiptImage);
$("#clientHistoryList")?.addEventListener("click",e=>{const b=e.target.closest("[data-open-receipt]");if(b){try{openReceiptDialog(JSON.parse(b.dataset.openReceipt))}catch(_){}}});
$("#orphanHistoryList")?.addEventListener("click",async e=>{const b=e.target.closest("[data-delete-history]");if(!b)return;const ok=await confirmCahesa("¿Eliminar definitivamente este registro de pago?",{title:"Eliminar historial",confirmText:"Eliminar",danger:true});if(!ok)return;try{await deleteDoc(doc(db,"users",currentUser.uid,"payments",b.dataset.deleteHistory));toast("Historial eliminado.")}catch(err){toast(friendlyError(err),"error")}});
$("#deleteAllOrphanHistoryBtn")?.addEventListener("click",async()=>{const orphan=payments.filter(p=>!clients.some(c=>c.id===p.clientId));if(!orphan.length){toast("No hay historiales conservados.");return}const ok=await confirmCahesa(`Se eliminarán ${orphan.length} pagos de clientes eliminados.`,{title:"Eliminar historiales",confirmText:"Eliminar todos",danger:true});if(!ok)return;const b=writeBatch(db);orphan.forEach(p=>b.delete(doc(db,"users",currentUser.uid,"payments",p.id)));await b.commit();toast("Historiales eliminados.")});

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
      if(nav.dataset.section==="mikrotik"){confirmCahesa("La conexión con MikroTik estará disponible próximamente. Esta función permanece bloqueada por ahora.",{title:"MikroTik 🔒",confirmText:"Entendido",cancelText:"Cerrar",danger:false});closeSidebar();return;}
      goSection(nav.dataset.section); closeSidebar();
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


    /* Eliminar cliente */

    const deleteClientBtn = e.target.closest("[data-delete-client]");
    if (deleteClientBtn) {
      deleteClient(deleteClientBtn.dataset.deleteClient);
      return;
    }

    const historyClient=e.target.closest("[data-history-client]");
    if(historyClient){openClientHistoryDialog(historyClient.dataset.historyClient);return;}

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

    "payment-calendar": "Seguimiento de pagos",

    network: "Mapa de red",

    mikrotik: "MikroTik",

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
    networkMap = L.map(el, { zoomControl: true }).setView([17.45, -93.35], 10);
    networkStreetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(networkMap);
    networkSatelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri'
    });
    networkMarkersLayer = L.layerGroup().addTo(networkMap);

    // Modo de colocación estilo Google Earth: la chincheta permanece fija
    // en el centro del mapa y el usuario mueve el mapa debajo de ella.
    const placementPin = document.createElement("div");
    placementPin.className = "network-map-placement-pin hidden";
    placementPin.innerHTML = `
      <div class="network-map-placement-marker">📍</div>
      <div class="network-map-placement-label">Colocar NAP</div>
    `;
    el.appendChild(placementPin);
    networkMap.__placementPin = placementPin;

    networkMap.on("click", () => {
      if (!pendingNetworkMapPlacement) return;

      // La coordenada elegida es SIEMPRE el centro del mapa, exactamente
      // debajo de la chincheta fija.
      const center = networkMap.getCenter();
      const lat = Number(center.lat.toFixed(7));
      const lng = Number(center.lng.toFixed(7));
      const target = pendingNetworkMapPlacement;
      pendingNetworkMapPlacement = null;
      setNetworkMapPlacementPin(false);

      openNetworkBoxDialog(
        target.isNew ? null : target.box,
        { latitude: lat, longitude: lng }
      );
      toast("Ubicación colocada. Revisa los datos y guarda el NAP.");
    });
  }
  setTimeout(() => networkMap.invalidateSize(), 80);
  setNetworkMapPlacementPin(Boolean(pendingNetworkMapPlacement));
  renderNetworkMarkers();
}

function setNetworkMapPlacementPin(active) {
  if (!networkMap?.__placementPin) return;
  networkMap.__placementPin.classList.toggle("hidden", !active);
}

function startNetworkBoxMapPlacement(target = null) {
  pendingNetworkMapPlacement = target
    ? { isNew: false, box: target }
    : { isNew: true, box: null };

  initNetworkMap();

  // Al editar, comenzamos exactamente sobre el NAP existente.
  if (target && Number.isFinite(Number(target.latitude)) && Number.isFinite(Number(target.longitude))) {
    networkMap.setView(
      [Number(target.latitude), Number(target.longitude)],
      Math.max(networkMap.getZoom(), 18),
      { animate: true }
    );
  }

  setNetworkMapPlacementPin(true);
  toast("Mueve el mapa hasta colocar la chincheta sobre el NAP y toca el mapa para fijarlo.");
}

function populateNetworkLocalityControls() {
  const select = $("#networkLocalityFilter");
  const boxSelect = $("#networkBoxLocality");
  const currentFilter = select?.value || "";
  const currentBoxLocality = boxSelect?.value || "";
  const options = networkLocalities.map(l => `<option value="${escapeHtml(l.name)}">${escapeHtml(l.name)}</option>`).join("");
  if (select) {
    select.innerHTML = `<option value="">Todas las localidades</option>${options}`;
    if (networkLocalities.some(l => l.name === currentFilter)) select.value = currentFilter;
  }
  if (boxSelect) {
    boxSelect.innerHTML = `<option value="">Sin localidad</option>${options}`;
    if (networkLocalities.some(l => l.name === currentBoxLocality)) boxSelect.value = currentBoxLocality;
  }
}

function filteredNetworkBoxes() {
  const locality = $("#networkLocalityFilter")?.value || "";
  const search = String($("#networkBoxSearch")?.value || "").trim().toLocaleLowerCase("es-MX");
  return networkBoxes.filter(box => {
    if (locality && String(box.locality || "") !== locality) return false;
    if (!search) return true;
    return [box.name, box.code, box.address, box.locality, box.notes].some(v => String(v || "").toLocaleLowerCase("es-MX").includes(search));
  });
}

function focusNetworkBox(box) {
  if (!box || !networkMap) return;
  const lat = Number(box.latitude), lng = Number(box.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    toast("Esta caja no tiene coordenadas válidas.", "error");
    return;
  }
  selectedNetworkBoxId = box.id;
  networkMap.setView([lat, lng], Math.max(networkMap.getZoom(), 17), { animate: true });
  renderNetworkDetail();
  const count = networkBoxClients(box.id).length;
  const capacity = Math.max(1, Number(box.capacity || 1));
  const free = Math.max(0, capacity - count);
  L.popup({ maxWidth: 240 })
    .setLatLng([lat, lng])
    .setContent(`<div class="network-mini-popup"><strong>${escapeHtml(box.name || "Caja")}</strong><span>${escapeHtml(box.code || "Sin código")}</span>${box.locality ? `<span>📍 ${escapeHtml(box.locality)}</span>` : ""}<span>👥 ${count} clientes · ${free} libres</span><span>● ${networkStatusLabel(box.status)}</span></div>`)
    .openOn(networkMap);
}

function renderNetwork() {
  const list = $("#networkBoxesList");
  const detail = $("#networkBoxDetail");
  const stats = $("#networkMapStats");
  if (!list || !detail || !stats) return;

  populateClientNetworkSelect();
  populateNetworkLocalityControls();
  const locatedClients = clients.filter(c => Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude)));
  stats.textContent = `${networkBoxes.length} ${networkBoxes.length === 1 ? "caja" : "cajas"} · ${locatedClients.length} ${locatedClients.length === 1 ? "cliente ubicado" : "clientes ubicados"} · ${networkLocalities.length} ${networkLocalities.length === 1 ? "localidad" : "localidades"}`;

  const visibleBoxes = filteredNetworkBoxes();
  if (!networkBoxes.length) {
    list.className = "network-box-list empty-state";
    list.textContent = "No hay cajas registradas. Puedes importar un KML o crear una caja.";
    detail.innerHTML = `<div class="empty-state">Crea o importa cajas para comenzar a construir tu mapa de red.</div>`;
  } else if (!visibleBoxes.length) {
    list.className = "network-box-list empty-state";
    list.textContent = "No hay cajas que coincidan con el filtro.";
  } else {
    list.className = "network-box-list";
    list.innerHTML = visibleBoxes.map(box => {
      const count = networkBoxClients(box.id).length;
      const active = box.id === selectedNetworkBoxId ? " active" : "";
      const status = box.status || "active";
      return `<button type="button" class="network-box-item${active}" data-network-box="${escapeHtml(box.id)}">
        <span class="network-box-dot ${status}"></span>
        <span class="grow"><strong>${escapeHtml(box.name || "Caja sin nombre")}</strong><span>${escapeHtml(box.code || "Sin código")} · ${escapeHtml(box.locality || "Sin localidad")} · ${count}/${Number(box.capacity || 0)} puertos ocupados</span></span>
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
      <div><h3>${escapeHtml(box.name || "Caja de red")}</h3><p class="muted">${escapeHtml(box.code || "Sin código")} · ${escapeHtml(box.locality || "Sin localidad")} · ${networkStatusLabel(box.status)}</p></div>
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
        return `<button type="button" class="port-chip ${c ? "occupied" : "empty"}" ${c ? `data-focus-client="${escapeHtml(c.id)}"` : `data-add-client-port="${port}"`}>${port}${c ? `<small>${escapeHtml((c.name || "").split(" ")[0])}</small>` : "<small>Agregar cliente</small>"}</button>`;
      }).join("")}</div>
    </div>
    ${box.address ? `<p class="muted"><strong>Referencia:</strong> ${escapeHtml(box.address)}</p>` : ""}
    ${box.notes ? `<p class="muted"><strong>Notas:</strong> ${escapeHtml(box.notes)}</p>` : ""}
    <div class="network-client-list">${connected.length ? connected.map(c => `<button type="button" class="network-client-row" data-focus-client="${escapeHtml(c.id)}"><strong>${escapeHtml(c.name)}</strong><span>Puerto ${Number(c.networkPort || 0) || "sin asignar"}${c.phone ? ` · ${escapeHtml(c.phone)}` : ""}</span>${c.equipmentModel || c.equipmentIp || c.equipmentSerial ? `<small>${escapeHtml([c.equipmentType, c.equipmentModel].filter(Boolean).join(" · "))}${c.equipmentIp ? ` · IP ${escapeHtml(c.equipmentIp)}` : ""}${c.equipmentSerial ? ` · Serie ${escapeHtml(c.equipmentSerial)}` : ""}</small>` : ""}</button>`).join("") : `<div class="empty-state">Todavía no hay clientes conectados.</div>`}</div>
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
      icon: L.divIcon({ className: "", html: `<div class="network-marker-pin">
  <span class="network-marker-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24"><path d="M4 20h16M6 17V9l6-4 6 4v8M9 17v-5h6v5M4 20l2-3h12l2 3"/></svg>
  </span>
  <small>${escapeHtml(box.code || box.name || "NAP")}</small>
</div>`, iconSize: [100, 42], iconAnchor: [50, 36] })
    });
    const capacity = Math.max(1, Number(box.capacity || 1));
    const free = Math.max(0, capacity - count);
    marker.bindPopup(`<div class="network-mini-popup"><strong>${escapeHtml(box.name || "Caja")}</strong><span>${escapeHtml(box.code || "Sin código")}</span>${box.locality ? `<span>📍 ${escapeHtml(box.locality)}</span>` : ""}<span>👥 ${count} clientes · ${free} puertos libres</span><span>● ${networkStatusLabel(box.status)}</span></div>`);
    marker.on("click", () => { selectedNetworkBoxId = box.id; renderNetwork(); });
    marker.addTo(networkMarkersLayer);
  });

  clients.filter(c => {
    const located = Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude));
    if (!located) return false;
    if (networkMapMode !== "connections") return true;
    return Boolean(networkBoxes.find(b => b.id === c.networkBoxId));
  }).forEach(c => {
    const lat = Number(c.latitude), lng = Number(c.longitude);
    const box = networkBoxes.find(b => b.id === c.networkBoxId);
    const equipment = [c.equipmentType, c.equipmentModel].filter(Boolean).join(" · ") || "Equipo no registrado";
    const details = [
      equipment,
      c.equipmentSerial ? `Serie: ${c.equipmentSerial}` : "",
      c.equipmentMac ? `MAC: ${c.equipmentMac}` : "",
      c.equipmentIp ? `IP: ${c.equipmentIp}` : "",
      c.equipmentSsid ? `Wi-Fi: ${c.equipmentSsid}` : "",
      box ? `${box.name} · Puerto ${Number(c.networkPort || 0) || "—"}` : "Sin caja asignada"
    ].filter(Boolean).map(escapeHtml).join("<br>");
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({ className: "", html: `<div class="network-client-marker" aria-label="Cliente">
  <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c.7-4 2.9-6 6.5-6s5.8 2 6.5 6"/></svg>
</div>`, iconSize: [30, 30], iconAnchor: [15, 15] })
    });
    marker.bindPopup(`<strong>${escapeHtml(c.name || "Cliente")}</strong><br>${details}`);
    marker.on("click", () => { if (box) selectedNetworkBoxId = box.id; });
    marker.addTo(networkMarkersLayer);

    if (box && Number.isFinite(Number(box.latitude)) && Number.isFinite(Number(box.longitude))) {
      const line = L.polyline([[Number(box.latitude), Number(box.longitude)], [lat, lng]], {
        weight: networkMapMode === "connections" ? 4 : 2,
        opacity: networkMapMode === "connections" ? 0.9 : 0.65,
        dashArray: networkMapMode === "connections" ? null : "7 7"
      });
      line.bindPopup(`<strong>${escapeHtml(box.name || "Caja")}</strong> → <strong>${escapeHtml(c.name || "Cliente")}</strong><br>Puerto ${Number(c.networkPort || 0) || "—"}`);
      line.addTo(networkMarkersLayer);
    }
  });
}

function openNetworkBoxDialog(box = null, coordinateOverride = null) {
  $("#networkBoxDialogTitle").textContent = box ? "Editar caja de red" : "Nueva caja de red";
  $("#networkBoxId").value = box?.id || "";
  $("#networkBoxName").value = box?.name || "";
  $("#networkBoxCode").value = box?.code || "";
  populateNetworkLocalityControls();
  $("#networkBoxLocality").value = box?.locality || "";
  $("#networkBoxCapacity").value = box?.capacity ?? 8;
  $("#networkBoxStatus").value = box?.status || "active";
  $("#networkBoxAddress").value = box?.address || "";
  $("#networkBoxLatitude").value = coordinateOverride?.latitude ?? box?.latitude ?? "";
  $("#networkBoxLongitude").value = coordinateOverride?.longitude ?? box?.longitude ?? "";
  $("#networkBoxNotes").value = box?.notes || "";
  $("#deleteNetworkBoxBtn").classList.toggle("hidden", !box);
  $("#deactivateNetworkBoxBtn").classList.toggle("hidden", !box);
  $("#deactivateNetworkBoxBtn").textContent = box?.status === "inactive" ? "Reactivar caja" : "Dar de baja";
  $("#networkBoxDialog").showModal();
}

function chooseNetworkBoxLocation() {
  const boxId = $("#networkBoxId").value || "";
  const existing = boxId ? networkBoxes.find(b => b.id === boxId) : null;
  $("#networkBoxDialog").close();
  startNetworkBoxMapPlacement(existing);
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
    const locality = $("#networkBoxLocality").value.trim();
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
      type: "networkBox", name, code, locality, capacity,
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

async function deactivateSelectedNetworkBox() {
  const id = $("#networkBoxId").value;
  if (!id || !currentUser) return;

  const box = networkBoxes.find(b => b.id === id);
  if (!box) return;

  const nextStatus = box.status === "inactive" ? "active" : "inactive";
  const isDeactivating = nextStatus === "inactive";

  const confirmed = await confirmCahesa(
    `¿Deseas ${isDeactivating ? "dar de baja" : "reactivar"} el NAP «${box.name || "sin nombre"}»?\n\nLos clientes permanecerán registrados y el NAP conservará su información.`,
    {
      title: isDeactivating ? "Dar de baja NAP" : "Reactivar NAP",
      confirmText: isDeactivating ? "Dar de baja" : "Reactivar",
      danger: isDeactivating
    }
  );
  if (!confirmed) return;

  const button = $("#deactivateNetworkBoxBtn");
  if (button) button.disabled = true;

  try {
    // setDoc(..., merge) tolera mejor documentos existentes y mantiene
    // intactos todos los demás campos del NAP.
    await setDoc(
      doc(db, "users", currentUser.uid, "assets", id),
      { status: nextStatus, updatedAt: serverTimestamp() },
      { merge: true }
    );

    // Reflejo inmediato en pantalla; Firestore seguirá sincronizando después.
    const localBox = networkBoxes.find(b => b.id === id);
    if (localBox) localBox.status = nextStatus;

    $("#networkBoxStatus").value = nextStatus;
    $("#deactivateNetworkBoxBtn").textContent = isDeactivating ? "Reactivar NAP" : "Dar de baja NAP";
    renderNetwork();

    toast(
      isDeactivating
        ? "NAP dado de baja correctamente."
        : "NAP reactivado correctamente."
    );
  } catch (err) {
    console.error("ERROR CAMBIANDO ESTADO NAP:", err);
    toast(friendlyError(err), "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function deleteSelectedNetworkBox() {
  const id = $("#networkBoxId").value;
  if (!id || !currentUser) return;
  const box = networkBoxes.find(b => b.id === id);
  if (!box) return;
  const connected = networkBoxClients(id);
  if (connected.length) {
    toast("No se puede eliminar una caja que todavía tiene clientes conectados. Puedes darle de baja para conservar su historial.", "error");
    return;
  }
  const confirmed = await confirmCahesa(
    `¿Eliminar definitivamente el NAP «${box.name || "sin nombre"}»?\n\nEsta acción no se puede deshacer.`,
    { title: "Eliminar NAP definitivamente", confirmText: "Eliminar definitivamente", danger: true }
  );
  if (!confirmed) return;
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "assets", id));
    if (selectedNetworkBoxId === id) selectedNetworkBoxId = "";
    $("#networkBoxDialog").close();
    toast("Caja eliminada definitivamente.");
  } catch (err) {
    console.error("ERROR ELIMINANDO CAJA:", err);
    toast(friendlyError(err), "error");
  }
}

function xmlLocalName(node) {
  return String(node?.localName || node?.nodeName || "").split(":").pop().toLowerCase();
}

function kmlText(parent, tag) {
  const el = [...(parent?.getElementsByTagName?.("*") || [])].find(n => xmlLocalName(n) === tag.toLowerCase());
  return el?.textContent?.trim() || "";
}

function kmlExtendedData(placemark) {
  const data = {};
  [...placemark.getElementsByTagName("*")].filter(n => xmlLocalName(n) === "data").forEach(node => {
    const key = node.getAttribute("name") || kmlText(node, "name");
    const value = kmlText(node, "value");
    if (key) data[normalizeText(key)] = value;
  });
  [...placemark.getElementsByTagName("*")].filter(n => xmlLocalName(n) === "simpledata").forEach(node => {
    const key = node.getAttribute("name");
    const value = node.textContent?.trim() || "";
    if (key) data[normalizeText(key)] = value;
  });
  return data;
}

function findKmlFolderName(placemark) {
  let parent = placemark.parentElement;
  while (parent) {
    if (xmlLocalName(parent) === "folder") {
      const name = kmlText(parent, "name");
      if (name) return name;
    }
    parent = parent.parentElement;
  }
  return "";
}

function parseKmlBoxes(text) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.getElementsByTagName("parsererror").length) throw new Error("El archivo KML no tiene un formato válido.");
  const placemarks = [...xml.getElementsByTagName("*")].filter(n => xmlLocalName(n) === "placemark");
  const boxes = [];
  placemarks.forEach((placemark, index) => {
    const point = [...placemark.getElementsByTagName("*")].find(n => xmlLocalName(n) === "point");
    if (!point) return;
    const coordinates = kmlText(point, "coordinates").split(",").map(Number);
    if (!Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return;
    const data = kmlExtendedData(placemark);
    const name = kmlText(placemark, "name") || `Caja importada ${index + 1}`;
    const code = data.codigo || data.code || data.cto || data.caja || "";
    const capacityRaw = data.capacidad || data.capacity || data.puertos || data.ports || "8";
    const capacity = Math.min(512, Math.max(1, Number.parseInt(capacityRaw, 10) || 8));
    const statusRaw = normalizeText(data.estado || data.status || "active");
    const status = statusRaw.includes("mantenimiento") || statusRaw === "maintenance" ? "maintenance" : statusRaw.includes("inactiv") || statusRaw === "inactive" ? "inactive" : "active";
    const locality = data.localidad || data.locality || data.lugar || findKmlFolderName(placemark) || "";
    const address = data.direccion || data.address || data.referencia || "";
    boxes.push({
      type: "networkBox", name, code, locality, capacity, status,
      address, latitude: coordinates[1], longitude: coordinates[0],
      notes: "Importada desde KML"
    });
  });
  return boxes;
}

async function importNetworkKml(file) {
  if (!currentUser || !file) return;
  try {
    showLoading(true);
    const text = await file.text();
    const boxes = parseKmlBoxes(text);
    if (!boxes.length) throw new Error("No encontré puntos (Point) en el KML para convertirlos en cajas.");
    const batchSize = 450;
    for (let start = 0; start < boxes.length; start += batchSize) {
      const batch = writeBatch(db);
      boxes.slice(start, start + batchSize).forEach(item => {
        const refDoc = doc(collection(db, "users", currentUser.uid, "assets"));
        batch.set(refDoc, { ...item, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
      await batch.commit();
    }
    toast(`Listo: ${boxes.length} cajas importadas desde KML.`);
  } catch (err) {
    console.error("ERROR IMPORTANDO KML:", err);
    toast(friendlyError(err), "error");
  } finally {
    showLoading(false);
    const input = $("#importNetworkKmlFile");
    if (input) input.value = "";
  }
}

function openNetworkLocalitiesDialog() {
  renderNetworkLocalitiesManager();
  $("#networkLocalitiesDialog")?.showModal();
}

function renderNetworkLocalitiesManager() {
  const list = $("#networkLocalitiesList");
  if (!list) return;
  list.innerHTML = networkLocalities.length ? networkLocalities.map(item => `<div class="network-locality-item"><span>${escapeHtml(item.name)}</span><button type="button" class="ghost small" data-delete-network-locality="${escapeHtml(item.id)}">Eliminar</button></div>`).join("") : `<div class="empty-state">No hay localidades. Puedes agregar una o cargar las iniciales.</div>`;
  populateNetworkLocalityControls();
}

async function addNetworkLocality(name) {
  if (!currentUser) return;
  const clean = String(name || "").trim().replace(/\s+/g, " ");
  if (!clean) return toast("Escribe el nombre de la localidad.", "error");
  if (networkLocalities.some(l => normalizeText(l.name) === normalizeText(clean))) return toast("Esa localidad ya existe.", "error");
  try {
    const refDoc = doc(collection(db, "users", currentUser.uid, "assets"));
    await setDoc(refDoc, { type: "networkLocality", name: clean, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    $("#newNetworkLocalityName").value = "";
    toast("Localidad agregada.");
  } catch (err) { toast(friendlyError(err), "error"); }
}

async function seedNetworkLocalities() {
  if (!currentUser) return;
  if (networkLocalities.length) return toast("Ya tienes localidades registradas. Puedes agregar otras manualmente o importarlas.", "error");
  const initial = ["Ostuacán", "Xochimilco", "Nuevo Xochimilco", "Viejo Xochimilco", "Plan de Ayala"];
  try {
    showLoading(true);
    const batch = writeBatch(db);
    initial.forEach(name => {
      const r = doc(collection(db, "users", currentUser.uid, "assets"));
      batch.set(r, { type: "networkLocality", name, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    await batch.commit();
    toast("Se cargaron las localidades iniciales.");
  } catch (err) { toast(friendlyError(err), "error"); }
  finally { showLoading(false); }
}

async function importNetworkLocalities(file) {
  if (!currentUser || !file) return;
  try {
    showLoading(true);
    let rows = [];
    if (/\.csv$/i.test(file.name)) {
      rows = csvToObjects(await file.text());
    } else {
      if (!window.XLSX) throw new Error("No se pudo cargar el lector de Excel. Si estás sin internet, usa CSV.");
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    }
    const names = rows.map(row => {
      const key = Object.keys(row).find(k => ["localidad","nombre","name","lugar"].includes(normalizeText(k)));
      return key ? String(row[key] || "").trim() : "";
    }).filter(Boolean);
    const unique = [...new Map(names.map(name => [normalizeText(name), name])).values()]
      .filter(name => !networkLocalities.some(l => normalizeText(l.name) === normalizeText(name)));
    if (!unique.length) throw new Error("No encontré localidades nuevas. Usa una columna llamada Localidad o Nombre.");
    const batchSize = 450;
    for (let start = 0; start < unique.length; start += batchSize) {
      const batch = writeBatch(db);
      unique.slice(start, start + batchSize).forEach(name => {
        const r = doc(collection(db, "users", currentUser.uid, "assets"));
        batch.set(r, { type: "networkLocality", name, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
      await batch.commit();
    }
    toast(`Listo: ${unique.length} localidades importadas.`);
  } catch (err) {
    console.error("ERROR IMPORTANDO LOCALIDADES:", err);
    toast(friendlyError(err), "error");
  } finally {
    showLoading(false);
    const input = $("#importNetworkLocalitiesFile");
    if (input) input.value = "";
  }
}

async function deleteNetworkLocality(id) {
  if (!currentUser || !id) return;
  const locality = networkLocalities.find(l => l.id === id);
  if (!locality) return;
  const used = networkBoxes.filter(b => normalizeText(b.locality) === normalizeText(locality.name)).length;
  if (used) return toast(`No se puede eliminar: ${used} caja(s) usan esta localidad.`, "error");
  const confirmed = await confirmCahesa(
    `¿Eliminar la localidad «${locality.name}»?`,
    { title: "Eliminar localidad", confirmText: "Eliminar", danger: true }
  );
  if (!confirmed) return;
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "assets", id));
    toast("Localidad eliminada.");
  } catch (err) { toast(friendlyError(err), "error"); }
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


$("#cahesaConfirmAccept")?.addEventListener("click", () => finishCahesaConfirm(true));
$("#cahesaConfirmCancel")?.addEventListener("click", () => finishCahesaConfirm(false));
$("#cahesaConfirmDialog")?.addEventListener("cancel", e => { e.preventDefault(); finishCahesaConfirm(false); });

$("#addNetworkBoxBtn")?.addEventListener("click", () => {
  startNetworkBoxMapPlacement();
});
$("#networkMapViewBtn")?.addEventListener("click", () => {
  networkMapMode = "map";
  $("#networkMapViewBtn")?.classList.add("active");
  $("#networkConnectionsViewBtn")?.classList.remove("active");
  renderNetworkMarkers();
});
$("#networkConnectionsViewBtn")?.addEventListener("click", () => {
  networkMapMode = "connections";
  $("#networkConnectionsViewBtn")?.classList.add("active");
  $("#networkMapViewBtn")?.classList.remove("active");
  renderNetworkMarkers();
  if (networkMap) {
    const points = [];
    networkBoxes.forEach(b => {
      if (Number.isFinite(Number(b.latitude)) && Number.isFinite(Number(b.longitude))) points.push([Number(b.latitude), Number(b.longitude)]);
      networkBoxClients(b.id).forEach(c => {
        if (Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude))) points.push([Number(c.latitude), Number(c.longitude)]);
      });
    });
    if (points.length > 1) networkMap.fitBounds(points, { padding: [30, 30], maxZoom: 17 });
    else if (points.length === 1) networkMap.setView(points[0], 17);
  }
});
$("#networkSatelliteBtn")?.addEventListener("click", () => {
  if (!networkMap || !networkStreetLayer || !networkSatelliteLayer) return;
  networkSatelliteOn = !networkSatelliteOn;
  if (networkSatelliteOn) {
    networkMap.removeLayer(networkStreetLayer);
    networkSatelliteLayer.addTo(networkMap);
    $("#networkSatelliteBtn").classList.add("active");
    $("#networkSatelliteBtn").textContent = "Mapa";
  } else {
    networkMap.removeLayer(networkSatelliteLayer);
    networkStreetLayer.addTo(networkMap);
    $("#networkSatelliteBtn").classList.remove("active");
    $("#networkSatelliteBtn").textContent = "Satélite";
  }
});
$("#seedNetworkExamplesBtn")?.addEventListener("click", seedNetworkExamples);
$("#importNetworkKmlBtn")?.addEventListener("click", () => $("#importNetworkKmlFile")?.click());
$("#importNetworkKmlFile")?.addEventListener("change", e => { const file = e.target.files?.[0]; if (file) importNetworkKml(file); });
$("#networkLocalityFilter")?.addEventListener("change", () => { renderNetwork(); const first = filteredNetworkBoxes()[0]; if (first) focusNetworkBox(first); });
$("#networkBoxSearch")?.addEventListener("input", () => { renderNetwork(); });
$("#manageNetworkLocalitiesBtn")?.addEventListener("click", openNetworkLocalitiesDialog);
$("#addNetworkLocalityBtn")?.addEventListener("click", () => addNetworkLocality($("#newNetworkLocalityName")?.value));
$("#newNetworkLocalityName")?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addNetworkLocality(e.target.value); } });
$("#seedNetworkLocalitiesBtn")?.addEventListener("click", seedNetworkLocalities);
$("#importNetworkLocalitiesBtn")?.addEventListener("click", () => $("#importNetworkLocalitiesFile")?.click());
$("#importNetworkLocalitiesFile")?.addEventListener("change", e => { const file = e.target.files?.[0]; if (file) importNetworkLocalities(file); });
$("#networkLocalitiesList")?.addEventListener("click", e => { const btn = e.target.closest("[data-delete-network-locality]"); if (btn) deleteNetworkLocality(btn.dataset.deleteNetworkLocality); });
$("#networkBoxForm")?.addEventListener("submit", saveNetworkBox);
$("#deleteNetworkBoxBtn")?.addEventListener("click", deleteSelectedNetworkBox);
$("#deactivateNetworkBoxBtn")?.addEventListener("click", deactivateSelectedNetworkBox);
$("#networkBoxUseLocationBtn")?.addEventListener("click", () => useBrowserLocation("#networkBoxLatitude", "#networkBoxLongitude"));
$("#networkBoxPickMapBtn")?.addEventListener("click", chooseNetworkBoxLocation);

$("#networkBoxesList")?.addEventListener("click", e => {
  const item = e.target.closest("[data-network-box]");
  if (!item) return;
  selectedNetworkBoxId = item.dataset.networkBox;
  renderNetwork();
  const box = networkBoxes.find(b => b.id === selectedNetworkBoxId);
  if (box) focusNetworkBox(box);
});

$("#networkBoxDetail")?.addEventListener("click", e => {
  const edit = e.target.closest("[data-edit-network-box]");
  if (edit) {
    const box = networkBoxes.find(b => b.id === edit.dataset.editNetworkBox);
    if (box) openNetworkBoxDialog(box);
    return;
  }
  const addPort = e.target.closest("[data-add-client-port]");
  if (addPort) {
    const box = networkBoxes.find(b => b.id === selectedNetworkBoxId);
    if (box) {
      openClientDialog();
      $("#clientNetworkBox").value = box.id;
      $("#clientNetworkPort").value = Number(addPort.dataset.addClientPort);
      $("#clientNetworkPort").dispatchEvent(new Event("change", { bubbles: true }));
      toast(`Puerto ${addPort.dataset.addClientPort} seleccionado. Completa el mismo formulario de cliente.`);
    }
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

const viewModeToggle = $("#viewModeToggle");
function applyViewMode(mode){
  const desktop = mode === "desktop";
  document.body.classList.toggle("desktop-view", desktop);
  if(viewModeToggle){
    viewModeToggle.textContent = desktop ? "▣ Vista celular" : "▣ Escritorio";
    viewModeToggle.title = desktop ? "Volver a vista celular" : "Cambiar a vista escritorio";
  }
  try{localStorage.setItem("cahesaViewMode", desktop ? "desktop" : "mobile")}catch(_){}
  setTimeout(()=>{
    if(typeof networkMap?.invalidateSize === "function") networkMap.invalidateSize();
  },80);
}
viewModeToggle?.addEventListener("click",()=>applyViewMode(document.body.classList.contains("desktop-view") ? "mobile" : "desktop"));
try{applyViewMode(localStorage.getItem("cahesaViewMode") === "desktop" ? "desktop" : "mobile")}catch(_){applyViewMode("mobile")}

const _goSectionOriginal = goSection;
goSection = function(name) {
  _goSectionOriginal(name);
  if (name === "network") initNetworkMap();
};
