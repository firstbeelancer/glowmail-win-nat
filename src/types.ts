export type Folder = {
  id: string;
  name: string;
  icon: string;
  children?: Folder[];
  parent?: string;
};

export type Contact = {
  id: string;
  name: string;
  email: string;
  avatar?: string;
};

export type Attachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
};

export type TagDef = {
  id: string;
  name: string;
  color: string;
};

export type CryptoInfo = {
  type: 'smime' | 'pgp' | null;
  signed: boolean;
  encrypted: boolean;
  verified?: boolean;         // null = not checked, true = valid, false = invalid
  verificationError?: string;
};

export type CryptoKeys = {
  smimeCertPem?: string;       // PEM-encoded S/MIME certificate (public)
  smimeKeyPem?: string;        // PEM-encoded S/MIME private key
  smimeCertPassword?: string;  // Password for PKCS#12 container
  pgpPublicKey?: string;       // Armored PGP public key
  pgpPrivateKey?: string;      // Armored PGP private key
  pgpPassphrase?: string;      // PGP key passphrase
};

export type Email = {
  id: string;
  folderId: string;
  from: Contact;
  to: Contact[];
  cc?: Contact[];
  bcc?: Contact[];
  subject: string;
  body: string;
  snippet: string;
  date: string;
  read: boolean;
  starred: boolean;
  tags: string[];
  importance?: 'high' | 'normal' | 'low';
  attachments: Attachment[];
  cryptoInfo?: CryptoInfo;
  headers: {
    messageId: string;
    inReplyTo?: string;
    references?: string;
    returnPath?: string;
    received?: string[];
    [key: string]: any;
  };
};

export type Signature = {
  id: string;
  name: string;
  content: string;
};

export type AuthMethod = 'password' | 'app-password';
export type AIProvider = 'openai' | 'gemini' | 'openai-compatible';

export type UserSettings = {
  account: {
    name: string;
    email: string;
    avatar?: string;
    glowMailId?: string;
  };
  server: {
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
    secure: boolean;
    authMethod: AuthMethod;
  };
  signature: string;
  signatures: Signature[];
  defaultSignatureId?: string;
  theme: 'dark' | 'light';
  emailBackground: string;
  fontColor: string;
  composerFont: string;
  customFonts: { name: string, url: string }[];
  availableTags: TagDef[];
  delayedSending: number;
  syncInterval: number;
  keepFiltersAcrossFolders: boolean;
  groupBy: 'none' | 'date' | 'sender' | 'tag';
  layoutMode: 'vertical' | 'horizontal';
  markAsReadDelay: number;
  language: 'en' | 'ru';
  aiEnabled: boolean;
  aiProvider: AIProvider;
  aiApiKey: string;
  aiModel: string;
  aiBaseUrl: string;
  folderColors: Record<string, string>;
  tigerMediaHub: {
    enabled: boolean;
    projectUrl: string;
    apiKey: string;
    userId: string;
    defaultFolder: string;
  };
  cryptoKeys: CryptoKeys;
  cryptoSignOutgoing: boolean;
  cryptoEncryptOutgoing: boolean;
  cryptoPreferredType: 'smime' | 'pgp';
};
