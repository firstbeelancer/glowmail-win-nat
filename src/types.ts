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

export type AuthMethod = 'password' | 'oauth2' | 'app-password' | 'encrypted-password' | 'kerberos' | 'ntlm' | 'tls-certificate';

export type UserSettings = {
  account: {
    name: string;
    email: string;
    avatar?: string;
  };
  server: {
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
    secure: boolean;
    authMethod: AuthMethod;
    oauthProvider?: string;
  };
  signature: string;
  signatures: Signature[];
  defaultSignatureId?: string;
  theme: 'dark' | 'light';
  emailBackground: string;
  fontColor: string;
  customFonts: { name: string, url: string }[];
  availableTags: TagDef[];
  delayedSending: number;
  syncInterval: number;
  keepFiltersAcrossFolders: boolean;
  groupBy: 'none' | 'date' | 'sender' | 'tag';
  layoutMode: 'vertical' | 'horizontal';
  markAsReadDelay: number;
  ldapServer: string;
  ldapBaseDn: string;
  language: 'en' | 'ru';
  aiEnabled: boolean;
  folderColors: Record<string, string>;
};
