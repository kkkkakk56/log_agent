import type { VaultEntry } from '../types/vault';

const VAULT_META_KEY = 'journal-agent.vault.meta.v1';
const VAULT_DATA_KEY = 'journal-agent.vault.data.v1';
const VAULT_VERIFIER_TEXT = 'journal-agent-vault-unlock-v1';
const VAULT_KDF_ITERATIONS = 210_000;

interface EncryptionBlob {
  iv: string;
  ciphertext: string;
}

interface VaultMeta {
  version: 1;
  kdfSalt: string;
  kdfIterations: number;
  verifier: EncryptionBlob;
  updatedAt: string;
}

interface VaultData {
  version: 1;
  payload: EncryptionBlob;
  updatedAt: string;
}

export interface VaultUnlockResult {
  session: VaultSession;
  entries: VaultEntry[];
}

export interface VaultSession {
  key: CryptoKey;
  meta: VaultMeta;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isEncryptionBlob = (value: unknown): value is EncryptionBlob =>
  isRecord(value) &&
  typeof value.iv === 'string' &&
  typeof value.ciphertext === 'string';

const isVaultMeta = (value: unknown): value is VaultMeta =>
  isRecord(value) &&
  value.version === 1 &&
  typeof value.kdfSalt === 'string' &&
  typeof value.kdfIterations === 'number' &&
  isEncryptionBlob(value.verifier) &&
  typeof value.updatedAt === 'string';

const isVaultData = (value: unknown): value is VaultData =>
  isRecord(value) &&
  value.version === 1 &&
  isEncryptionBlob(value.payload) &&
  typeof value.updatedAt === 'string';

const isVaultEntry = (value: unknown): value is VaultEntry =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.title === 'string' &&
  typeof value.account === 'string' &&
  typeof value.password === 'string' &&
  typeof value.createdAt === 'string' &&
  typeof value.updatedAt === 'string' &&
  (value.website === undefined || typeof value.website === 'string') &&
  (value.note === undefined || typeof value.note === 'string');

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  Uint8Array.from(bytes).buffer;

const sortEntries = (entries: VaultEntry[]): VaultEntry[] =>
  [...entries].sort(
    (firstEntry, secondEntry) =>
      new Date(secondEntry.updatedAt).getTime() - new Date(firstEntry.updatedAt).getTime(),
  );

const readParsedItem = <T>(storageKey: string, guard: (value: unknown) => value is T): T | null => {
  try {
    const rawValue = localStorage.getItem(storageKey);

    if (!rawValue) {
      return null;
    }

    const parsedValue: unknown = JSON.parse(rawValue);

    return guard(parsedValue) ? parsedValue : null;
  } catch {
    return null;
  }
};

const writeItem = (storageKey: string, value: unknown): boolean => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

const getVaultMeta = (): VaultMeta | null =>
  readParsedItem(VAULT_META_KEY, isVaultMeta);

const getVaultData = (): VaultData | null =>
  readParsedItem(VAULT_DATA_KEY, isVaultData);

const decodeVaultEntries = (value: unknown): VaultEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortEntries(value.filter(isVaultEntry));
};

const isCryptoSupported = (): boolean =>
  typeof crypto !== 'undefined' &&
  typeof crypto.getRandomValues === 'function' &&
  typeof crypto.subtle !== 'undefined';

const deriveVaultKey = async (
  password: string,
  salt: string,
  iterations: number,
): Promise<CryptoKey> => {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(base64ToBytes(salt)),
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  );
};

const encryptString = async (value: string, key: CryptoKey): Promise<EncryptionBlob> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    textEncoder.encode(value),
  );

  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
  };
};

const decryptString = async (
  payload: EncryptionBlob,
  key: CryptoKey,
): Promise<string | null> => {
  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(base64ToBytes(payload.iv)),
      },
      key,
      toArrayBuffer(base64ToBytes(payload.ciphertext)),
    );

    return textDecoder.decode(decryptedBuffer);
  } catch {
    return null;
  }
};

export const isVaultFeatureSupported = (): boolean => isCryptoSupported();

export const isVaultConfigured = (): boolean =>
  Boolean(getVaultMeta() && getVaultData());

export const initializeVault = async (
  password: string,
): Promise<VaultUnlockResult | null> => {
  if (!isCryptoSupported()) {
    return null;
  }

  const normalizedPassword = password.trim();

  if (normalizedPassword.length < 4) {
    return null;
  }

  const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveVaultKey(
    normalizedPassword,
    salt,
    VAULT_KDF_ITERATIONS,
  );
  const now = new Date().toISOString();
  const verifier = await encryptString(VAULT_VERIFIER_TEXT, key);
  const payload = await encryptString(JSON.stringify([]), key);
  const meta: VaultMeta = {
    version: 1,
    kdfSalt: salt,
    kdfIterations: VAULT_KDF_ITERATIONS,
    verifier,
    updatedAt: now,
  };
  const data: VaultData = {
    version: 1,
    payload,
    updatedAt: now,
  };

  if (!writeItem(VAULT_META_KEY, meta) || !writeItem(VAULT_DATA_KEY, data)) {
    return null;
  }

  return {
    session: {
      key,
      meta,
    },
    entries: [],
  };
};

export const unlockVault = async (
  password: string,
): Promise<VaultUnlockResult | null> => {
  if (!isCryptoSupported()) {
    return null;
  }

  const meta = getVaultMeta();
  const data = getVaultData();
  const normalizedPassword = password.trim();

  if (!meta || !data || !normalizedPassword) {
    return null;
  }

  const key = await deriveVaultKey(
    normalizedPassword,
    meta.kdfSalt,
    meta.kdfIterations,
  );
  const verifier = await decryptString(meta.verifier, key);

  if (verifier !== VAULT_VERIFIER_TEXT) {
    return null;
  }

  const decryptedPayload = await decryptString(data.payload, key);

  if (decryptedPayload === null) {
    return null;
  }

  let parsedEntries: unknown = null;

  try {
    parsedEntries = JSON.parse(decryptedPayload);
  } catch {
    parsedEntries = [];
  }

  return {
    session: {
      key,
      meta,
    },
    entries: decodeVaultEntries(parsedEntries),
  };
};

export const saveVaultEntries = async (
  entries: VaultEntry[],
  session: VaultSession,
): Promise<boolean> => {
  if (!isCryptoSupported()) {
    return false;
  }

  const nextEntries = decodeVaultEntries(entries);
  const now = new Date().toISOString();
  const payload = await encryptString(JSON.stringify(nextEntries), session.key);
  const nextData: VaultData = {
    version: 1,
    payload,
    updatedAt: now,
  };
  const nextMeta: VaultMeta = {
    ...session.meta,
    updatedAt: now,
  };

  if (!writeItem(VAULT_DATA_KEY, nextData) || !writeItem(VAULT_META_KEY, nextMeta)) {
    return false;
  }

  session.meta = nextMeta;

  return true;
};
