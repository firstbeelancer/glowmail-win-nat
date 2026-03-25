import * as openpgp from "npm:openpgp@5.11.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(msg: string, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* ─── PGP: Verify cleartext or detached signature ─── */
async function pgpVerify(body: any) {
  const { armoredMessage, publicKeyArmored, cleartext } = body;

  if (!publicKeyArmored) return err("Missing publicKeyArmored", 400);

  try {
    const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });

    // Cleartext signed message (-----BEGIN PGP SIGNED MESSAGE-----)
    if (cleartext) {
      const msg = await openpgp.readCleartextMessage({ cleartextMessage: cleartext });
      const result = await openpgp.verify({
        message: msg,
        verificationKeys: publicKey,
      });
      const sig = result.signatures[0];
      try {
        await sig.verified;
        return ok({
          verified: true,
          keyId: sig.keyID.toHex(),
          signedBy: publicKey.getUserIDs(),
        });
      } catch (e) {
        return ok({
          verified: false,
          error: e instanceof Error ? e.message : "Signature verification failed",
        });
      }
    }

    // Armored signed message
    if (armoredMessage) {
      const message = await openpgp.readMessage({ armoredMessage });
      const result = await openpgp.verify({
        message,
        verificationKeys: publicKey,
      });
      const sig = result.signatures[0];
      try {
        await sig.verified;
        return ok({
          verified: true,
          keyId: sig.keyID.toHex(),
          signedBy: publicKey.getUserIDs(),
        });
      } catch (e) {
        return ok({
          verified: false,
          error: e instanceof Error ? e.message : "Signature verification failed",
        });
      }
    }

    return err("Provide armoredMessage or cleartext", 400);
  } catch (e) {
    return ok({
      verified: false,
      error: e instanceof Error ? e.message : "PGP verification error",
    });
  }
}

/* ─── PGP: Decrypt message ─── */
async function pgpDecrypt(body: any) {
  const { armoredMessage, privateKeyArmored, passphrase } = body;

  if (!armoredMessage || !privateKeyArmored) {
    return err("Missing armoredMessage or privateKeyArmored", 400);
  }

  try {
    let privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
    if (passphrase) {
      privateKey = await openpgp.decryptKey({ privateKey, passphrase });
    }

    const message = await openpgp.readMessage({ armoredMessage });
    const { data: decrypted } = await openpgp.decrypt({
      message,
      decryptionKeys: privateKey,
    });

    return ok({ decrypted });
  } catch (e) {
    return err(e instanceof Error ? e.message : "Decryption failed");
  }
}

/* ─── PGP: Sign message ─── */
async function pgpSign(body: any) {
  const { text, privateKeyArmored, passphrase } = body;

  if (!text || !privateKeyArmored) {
    return err("Missing text or privateKeyArmored", 400);
  }

  try {
    let privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
    if (passphrase) {
      privateKey = await openpgp.decryptKey({ privateKey, passphrase });
    }

    const message = await openpgp.createCleartextMessage({ text });
    const signed = await openpgp.sign({
      message,
      signingKeys: privateKey,
    });

    return ok({ signed });
  } catch (e) {
    return err(e instanceof Error ? e.message : "Signing failed");
  }
}

/* ─── PGP: Encrypt (and optionally sign) ─── */
async function pgpEncrypt(body: any) {
  const { text, recipientPublicKeys, privateKeyArmored, passphrase } = body;

  if (!text || !recipientPublicKeys?.length) {
    return err("Missing text or recipientPublicKeys", 400);
  }

  try {
    const publicKeys = await Promise.all(
      recipientPublicKeys.map((k: string) => openpgp.readKey({ armoredKey: k }))
    );

    const encryptOpts: any = {
      message: await openpgp.createMessage({ text }),
      encryptionKeys: publicKeys,
    };

    // Optionally sign while encrypting
    if (privateKeyArmored) {
      let privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
      if (passphrase) {
        privateKey = await openpgp.decryptKey({ privateKey, passphrase });
      }
      encryptOpts.signingKeys = privateKey;
    }

    const encrypted = await openpgp.encrypt(encryptOpts);

    return ok({ encrypted });
  } catch (e) {
    return err(e instanceof Error ? e.message : "Encryption failed");
  }
}

/* ─── S/MIME: Basic certificate info extraction ─── */
async function smimeInfo(body: any) {
  // For S/MIME we can at least parse the PEM cert and extract basic info
  const { certPem } = body;
  if (!certPem) return err("Missing certPem", 400);

  try {
    // Extract basic info from PEM cert using regex (lightweight approach)
    const b64 = certPem
      .replace(/-----BEGIN CERTIFICATE-----/, "")
      .replace(/-----END CERTIFICATE-----/, "")
      .replace(/\s/g, "");

    // Decode base64 to check cert is valid
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    return ok({
      valid: true,
      size: raw.length,
      message: "S/MIME certificate loaded. Full verification requires the sender's certificate chain.",
    });
  } catch (e) {
    return ok({
      valid: false,
      error: e instanceof Error ? e.message : "Invalid certificate",
    });
  }
}

/* ─── Router ─── */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "pgp-verify":
        return await pgpVerify(body);
      case "pgp-decrypt":
        return await pgpDecrypt(body);
      case "pgp-sign":
        return await pgpSign(body);
      case "pgp-encrypt":
        return await pgpEncrypt(body);
      case "smime-info":
        return await smimeInfo(body);
      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error("crypto-proxy error:", e);
    return err(e instanceof Error ? e.message : "Internal error");
  }
});
