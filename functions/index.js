const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2/options");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const crypto = require("crypto");

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const db = getFirestore();
const PAIRING_TTL_MS = 10 * 60 * 1000;
const CONNECTOR_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function requireRealUser(request) {
  const uid = request.auth?.uid;
  const provider = request.auth?.token?.firebase?.sign_in_provider;
  if (!uid || provider === "anonymous") {
    throw new HttpsError("unauthenticated", "Se requiere una cuenta CAHESA autenticada.");
  }
  return uid;
}

function randomCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

exports.createConnectorPairing = onCall(async (request) => {
  const uid = requireRealUser(request);
  const code = randomCode();
  const codeHash = hash(code);
  const expiresAt = Timestamp.fromMillis(Date.now() + PAIRING_TTL_MS);

  await db.collection("connectorPairings").doc(codeHash).set({
    uid,
    codeHash,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt
  });

  return {
    code,
    expiresAt: expiresAt.toDate().toISOString()
  };
});

exports.pairConnector = onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const code = String(req.body?.code || "").trim().toUpperCase();
    const connectorName = String(req.body?.connectorName || "CAHESA Connector").trim().slice(0, 80);
    if (!/^[A-F0-9]{8}$/.test(code)) return res.status(400).json({ error: "invalid_code" });

    const pairingRef = db.collection("connectorPairings").doc(hash(code));
    const pairingSnap = await pairingRef.get();
    if (!pairingSnap.exists) return res.status(400).json({ error: "pairing_not_found" });

    const pairing = pairingSnap.data();
    if (pairing.status !== "pending") return res.status(400).json({ error: "pairing_already_used" });
    if (!pairing.expiresAt || pairing.expiresAt.toMillis() < Date.now()) {
      await pairingRef.update({ status: "expired" });
      return res.status(400).json({ error: "pairing_expired" });
    }

    const connectorId = crypto.randomUUID();
    const token = `v1.${connectorId}.${crypto.randomBytes(32).toString("base64url")}`;
    const tokenHash = hash(token);

    const connectorRef = db.collection("users").doc(pairing.uid).collection("connectors").doc(connectorId);
    await db.runTransaction(async tx => {
      const current = await tx.get(pairingRef);
      if (!current.exists || current.data().status !== "pending") throw new Error("PAIRING_RACE");
      tx.update(pairingRef, {
        status: "claimed",
        claimedAt: FieldValue.serverTimestamp(),
        connectorId
      });
      tx.set(connectorRef, {
        name: connectorName || "CAHESA Connector",
        status: "paired",
        tokenHash,
        tokenCreatedAt: FieldValue.serverTimestamp(),
        tokenExpiresAt: Timestamp.fromMillis(Date.now() + CONNECTOR_TOKEN_TTL_MS),
        createdAt: FieldValue.serverTimestamp(),
        lastSeenAt: null,
        mode: "read_only"
      });
    });

    return res.status(200).json({ connectorId, token, mode: "read_only" });
  } catch (err) {
    if (err?.message === "PAIRING_RACE") return res.status(409).json({ error: "pairing_already_used" });
    console.error("pairConnector error", err);
    return res.status(500).json({ error: "pairing_failed" });
  }
});

exports.connectorSnapshot = onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const auth = String(req.get("authorization") || "");
    if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "missing_token" });
    const token = auth.slice(7).trim();
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return res.status(401).json({ error: "invalid_token" });
    const connectorId = parts[1];

    const users = await db.collectionGroup("connectors").where("tokenHash", "==", hash(token)).limit(1).get();
    if (users.empty) return res.status(401).json({ error: "invalid_token" });
    const connectorRef = users.docs[0].ref;
    if (connectorRef.id !== connectorId) return res.status(401).json({ error: "invalid_token" });
    const connector = users.docs[0].data();
    if (connector.tokenExpiresAt?.toMillis && connector.tokenExpiresAt.toMillis() < Date.now()) return res.status(401).json({ error: "token_expired" });

    const body = req.body || {};
    const clients = Array.isArray(body.clients) ? body.clients.slice(0, 200).map(c => ({
      secret: String(c.secret || c.name || "").slice(0, 120),
      name: String(c.name || c.secret || "").slice(0, 120),
      comment: String(c.comment || "").slice(0, 200),
      profile: String(c.profile || "").slice(0, 80),
      status: String(c.status || "OFFLINE").slice(0, 20),
      address: String(c.address || c.remoteAddress || "").slice(0, 80)
    })) : [];

    const snapshot = {
      identity: String(body.identity || "").slice(0, 100),
      routerOS: String(body.routerOS || "").slice(0, 50),
      board: String(body.board || "").slice(0, 80),
      model: String(body.model || "").slice(0, 80),
      pppSecrets: Number(body.pppSecrets) || clients.length,
      enabled: Number(body.enabled) || 0,
      disabled: Number(body.disabled) || 0,
      active: Number(body.active) || 0,
      clients,
      reportedAt: FieldValue.serverTimestamp()
    };

    const snapRef = connectorRef.collection("snapshots").doc("latest");
    await db.runTransaction(async tx => {
      tx.set(snapRef, snapshot, { merge: true });
      tx.update(connectorRef, {
        status: "online",
        lastSeenAt: FieldValue.serverTimestamp(),
        mode: "read_only"
      });
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("connectorSnapshot error", err);
    return res.status(500).json({ error: "snapshot_failed" });
  }
});
