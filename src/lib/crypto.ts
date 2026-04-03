import type { Key, MaybeMessage, Message, CleartextMessage } from "openpgp";

type VerifyParams = {
  armoredMessage?: string;
  cleartext?: string;
  publicKeyArmored: string;
};

type DecryptParams = {
  armoredMessage: string;
  privateKeyArmored: string;
  passphrase?: string;
};

type SignParams = {
  text: string;
  privateKeyArmored: string;
  passphrase?: string;
};

type EncryptParams = {
  text: string;
  recipientPublicKeys: string[];
  privateKeyArmored?: string;
  passphrase?: string;
};

async function getOpenPgp() {
  return import("openpgp");
}

async function readUnlockedPrivateKey(privateKeyArmored: string, passphrase?: string) {
  const openpgp = await getOpenPgp();
  let privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });

  if (passphrase) {
    privateKey = await openpgp.decryptKey({ privateKey, passphrase });
  }

  return privateKey;
}

export async function pgpVerifySignature(params: VerifyParams) {
  const openpgp = await getOpenPgp();
  const publicKey = await openpgp.readKey({ armoredKey: params.publicKeyArmored });

  let message: Message<string> | CleartextMessage;

  if (params.cleartext) {
    message = await openpgp.readCleartextMessage({
      cleartextMessage: params.cleartext,
    });
  } else if (params.armoredMessage) {
    message = await openpgp.readMessage({
      armoredMessage: params.armoredMessage,
    });
  } else {
    throw new Error("Provide armoredMessage or cleartext");
  }

  try {
    const result = await openpgp.verify({
      message: message as MaybeMessage<string>,
      verificationKeys: publicKey,
    });
    const signature = result.signatures[0];

    if (!signature) {
      return {
        verified: false,
        error: "No signature found",
      };
    }

    try {
      await signature.verified;

      return {
        verified: true,
        keyId: signature.keyID.toHex(),
        signedBy: publicKey.getUserIDs(),
      };
    } catch (error) {
      return {
        verified: false,
        error: error instanceof Error ? error.message : "Signature verification failed",
      };
    }
  } catch (error) {
    return {
      verified: false,
      error: error instanceof Error ? error.message : "PGP verification error",
    };
  }
}

export async function pgpDecryptMessage(params: DecryptParams) {
  const openpgp = await getOpenPgp();
  const privateKey = await readUnlockedPrivateKey(
    params.privateKeyArmored,
    params.passphrase,
  );
  const message = await openpgp.readMessage({
    armoredMessage: params.armoredMessage,
  });
  const { data } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
  });

  return { decrypted: data as string };
}

export async function pgpSignMessage(params: SignParams) {
  const openpgp = await getOpenPgp();
  const privateKey = await readUnlockedPrivateKey(
    params.privateKeyArmored,
    params.passphrase,
  );
  const message = await openpgp.createCleartextMessage({ text: params.text });
  const signed = await openpgp.sign({
    message,
    signingKeys: privateKey,
  });

  return { signed };
}

export async function pgpEncryptMessage(params: EncryptParams) {
  const openpgp = await getOpenPgp();
  const publicKeys = await Promise.all(
    params.recipientPublicKeys.map((armoredKey) =>
      openpgp.readKey({ armoredKey }),
    ),
  );
  const encryptOptions: {
    message: Message<string>;
    encryptionKeys: Key[];
    signingKeys?: Key;
  } = {
    message: await openpgp.createMessage({ text: params.text }),
    encryptionKeys: publicKeys,
  };

  if (params.privateKeyArmored) {
    encryptOptions.signingKeys = await readUnlockedPrivateKey(
      params.privateKeyArmored,
      params.passphrase,
    );
  }

  const encrypted = await openpgp.encrypt(encryptOptions);
  return { encrypted };
}

export async function smimeCertInfo(certPem: string) {
  if (!certPem.trim()) {
    throw new Error("Missing certPem");
  }

  try {
    const base64Body = certPem
      .replace(/-----BEGIN CERTIFICATE-----/, "")
      .replace(/-----END CERTIFICATE-----/, "")
      .replace(/\s/g, "");

    const raw = Uint8Array.from(atob(base64Body), (char) => char.charCodeAt(0));

    return {
      valid: true,
      size: raw.length,
      message:
        "S/MIME certificate loaded. Full verification requires the sender's certificate chain.",
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid certificate",
    };
  }
}
