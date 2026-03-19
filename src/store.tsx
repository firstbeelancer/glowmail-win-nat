import { createContext, useContext, useState, ReactNode, useMemo, useEffect } from 'react';
import { Email, Folder, Contact, UserSettings, TagDef } from './types';

const MOCK_FOLDERS: Folder[] = [
  { id: 'inbox', name: 'Inbox', icon: 'inbox' },
  { id: 'sent', name: 'Sent', icon: 'send' },
  { id: 'outbox', name: 'Outbox', icon: 'clock' },
  { id: 'drafts', name: 'Drafts', icon: 'file' },
  { id: 'spam', name: 'Spam', icon: 'alert-circle' },
  { id: 'trash', name: 'Trash', icon: 'trash-2' },
  { id: 'work', name: 'Work', icon: 'briefcase' },
];

const MOCK_CONTACTS: Contact[] = [
  { id: 'c1', name: 'Alice Smith', email: 'alice@example.com' },
  { id: 'c2', name: 'Bob Jones', email: 'bob@example.com' },
  { id: 'c3', name: 'Charlie Brown', email: 'charlie@example.com' },
];

const MOCK_EMAILS: Email[] = [
  {
    id: 'e1',
    folderId: 'inbox',
    from: MOCK_CONTACTS[0],
    to: [{ id: 'me', name: 'Me', email: 'me@example.com' }],
    subject: 'Project Update: Q3 Goals',
    snippet: 'Hi team, just wanted to share the latest updates on our Q3 goals...',
    body: '<p>Hi team,</p><p>Just wanted to share the latest updates on our Q3 goals. We are currently on track to hit our targets.</p><p>Best,<br>Alice</p>',
    date: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    read: false,
    starred: true,
    tags: ['work', 'urgent'],
    attachments: [],
    headers: {
      messageId: '<12345@example.com>',
      returnPath: '<alice@example.com>',
    },
  },
  {
    id: 'e2',
    folderId: 'inbox',
    from: MOCK_CONTACTS[1],
    to: [{ id: 'me', name: 'Me', email: 'me@example.com' }],
    subject: 'Lunch tomorrow?',
    snippet: 'Are we still on for lunch tomorrow at 12:30?',
    body: '<p>Are we still on for lunch tomorrow at 12:30? Let me know if you need to reschedule.</p>',
    date: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    read: true,
    starred: false,
    tags: ['personal'],
    attachments: [],
    headers: {
      messageId: '<67890@example.com>',
    },
  },
  {
    id: 'e3',
    folderId: 'inbox',
    from: MOCK_CONTACTS[2],
    to: [{ id: 'me', name: 'Me', email: 'me@example.com' }],
    subject: 'Invoice #INV-2023-001',
    snippet: 'Please find attached the invoice for the recent consulting work.',
    body: '<p>Please find attached the invoice for the recent consulting work.</p>',
    date: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    read: false,
    starred: false,
    tags: ['finance'],
    attachments: [
      {
        id: 'a1',
        name: 'invoice.pdf',
        size: 1024 * 150,
        type: 'application/pdf',
        url: '#',
      },
    ],
    headers: {
      messageId: '<abcde@example.com>',
    },
  },
  {
    id: 'e4',
    folderId: 'drafts',
    from: { id: 'me', name: 'Me', email: 'me@example.com' },
    to: [{ id: 'c1', name: 'Alice Smith', email: 'alice@example.com' }],
    subject: 'Draft: Quarterly Review',
    snippet: 'Hi Alice, I am working on the quarterly review...',
    body: '<p>Hi Alice,</p><p>I am working on the quarterly review and will send it to you soon.</p>',
    date: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    read: true,
    starred: false,
    tags: ['work'],
    attachments: [],
    headers: {
      messageId: '<draft1@example.com>',
    },
  },
];

type MailContextType = {
  folders: Folder[];
  emails: Email[];
  contacts: Contact[];
  settings: UserSettings;
  currentFolder: string;
  setCurrentFolder: (id: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  markAsRead: (id: string) => void;
  toggleStar: (id: string) => void;
  deleteEmail: (id: string) => void;
  sendEmail: (email: Partial<Email>) => void;
  saveDraft: (email: Partial<Email>) => void;
  addContact: (contact: Contact) => void;
  updateSettings: (settings: Partial<UserSettings>) => void;
  fetchEmails: () => Promise<void>;
  addFolder: (name: string) => void;
  updateEmailTags: (id: string, tags: string[]) => void;
};

const MailContext = createContext<MailContextType | undefined>(undefined);

export function MailProvider({ children }: { children: ReactNode }) {
  const [folders, setFolders] = useState<Folder[]>(MOCK_FOLDERS);
  const [emails, setEmails] = useState<Email[]>(MOCK_EMAILS);
  const [contacts, setContacts] = useState<Contact[]>(MOCK_CONTACTS);
  const [currentFolder, setCurrentFolder] = useState<string>('inbox');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [settings, setSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem('glowmail_settings');
    let parsedSettings: Partial<UserSettings> = {};
    if (saved) {
      try {
        parsedSettings = JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse settings', e);
      }
    }
    
    const defaultSignature = parsedSettings.signature || '<p><br>--<br>Sent from GlowMail AI</p>';
    const signatures = parsedSettings.signatures || [{ id: 'default', name: 'Default', content: defaultSignature }];
    
    return {
      account: {
        name: 'Me',
        email: 'me@example.com',
      },
      server: {
        imapHost: 'imap.example.com',
        imapPort: 993,
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        secure: true,
        authMethod: parsedSettings.server?.authMethod || 'password',
        oauthProvider: parsedSettings.server?.oauthProvider || '',
      },
      signature: defaultSignature,
      signatures,
      defaultSignatureId: parsedSettings.defaultSignatureId || signatures[0]?.id,
      theme: parsedSettings.theme || 'dark',
      emailBackground: parsedSettings.emailBackground || '#09090b',
      fontColor: parsedSettings.fontColor || '#e4e4e7',
      customFonts: parsedSettings.customFonts || [],
      delayedSending: parsedSettings.delayedSending || 0,
      syncInterval: parsedSettings.syncInterval ?? 5,
      keepFiltersAcrossFolders: parsedSettings.keepFiltersAcrossFolders ?? false,
      groupBy: parsedSettings.groupBy || 'none',
      markAsReadDelay: parsedSettings.markAsReadDelay ?? 0,
      ldapServer: parsedSettings.ldapServer || '',
      ldapBaseDn: parsedSettings.ldapBaseDn || '',
      language: parsedSettings.language || 'en',
      availableTags: parsedSettings.availableTags || [
        { id: '1', name: 'work', color: '#3b82f6' },
        { id: '2', name: 'urgent', color: '#ef4444' },
        { id: '3', name: 'personal', color: '#10b981' },
        { id: '4', name: 'finance', color: '#f59e0b' },
        { id: '5', name: 'project', color: '#8b5cf6' },
      ],
      ...parsedSettings,
    };
  });

  useEffect(() => {
    localStorage.setItem('glowmail_settings', JSON.stringify(settings));
  }, [settings]);

  const fetchEmails = async () => {
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 1000);
    });
  };

  const markAsRead = (id: string) => {
    setEmails((prev) =>
      prev.map((e) => {
        if (e.id === id && !e.read) {
          return { ...e, read: true };
        }
        return e;
      })
    );
  };

  const toggleStar = (id: string) => {
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, starred: !e.starred } : e))
    );
  };

  const deleteEmail = (id: string) => {
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, folderId: 'trash' } : e))
    );
  };

  const sendEmail = (email: Partial<Email>) => {
    const delayMinutes = settings.delayedSending || 0;
    const isDelayed = delayMinutes > 0;
    const folderId = isDelayed ? 'outbox' : 'sent';

    const newEmail: Email = {
      id: `e${Date.now()}`,
      folderId,
      from: { id: 'me', name: 'Me', email: 'me@example.com' },
      to: email.to || [],
      cc: email.cc || [],
      bcc: email.bcc || [],
      subject: email.subject || '(No Subject)',
      body: email.body || '',
      snippet: (email.body || '').replace(/<[^>]*>?/gm, '').substring(0, 50),
      date: new Date().toISOString(),
      read: true,
      starred: false,
      tags: [],
      attachments: email.attachments || [],
      headers: { messageId: `<${Date.now()}@example.com>` },
    };
    setEmails((prev) => {
      const updated = email.id ? prev.filter(e => e.id !== email.id) : prev;
      return [newEmail, ...updated];
    });
    
    email.to?.forEach(addContact);
    email.cc?.forEach(addContact);
    email.bcc?.forEach(addContact);

    if (isDelayed) {
      setTimeout(() => {
        setEmails((prev) => 
          prev.map(e => e.id === newEmail.id ? { ...e, folderId: 'sent', date: new Date().toISOString() } : e)
        );
      }, delayMinutes * 60 * 1000);
    }
  };

  const saveDraft = (email: Partial<Email>) => {
    const newEmail: Email = {
      id: email.id || `e${Date.now()}`,
      folderId: 'drafts',
      from: { id: 'me', name: 'Me', email: 'me@example.com' },
      to: email.to || [],
      cc: email.cc || [],
      bcc: email.bcc || [],
      subject: email.subject || '',
      body: email.body || '',
      snippet: (email.body || '').replace(/<[^>]*>?/gm, '').substring(0, 50),
      date: new Date().toISOString(),
      read: true,
      starred: false,
      tags: [],
      attachments: email.attachments || [],
      headers: { messageId: `<${Date.now()}@example.com>` },
    };
    setEmails((prev) => {
      const updated = email.id ? prev.filter(e => e.id !== email.id) : prev;
      return [newEmail, ...updated];
    });
  };

  const addContact = (contact: Contact) => {
    setContacts((prev) => {
      if (!prev.find((c) => c.email === contact.email)) {
        return [...prev, contact];
      }
      return prev;
    });
  };

  const updateSettings = (newSettings: Partial<UserSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  };

  const addFolder = (name: string) => {
    const newFolder: Folder = {
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      icon: 'folder',
    };
    setFolders((prev) => [...prev, newFolder]);
  };

  const value = useMemo(
    () => ({
      folders,
      emails,
      contacts,
      settings,
      currentFolder,
      setCurrentFolder,
      searchQuery,
      setSearchQuery,
      markAsRead,
      toggleStar,
      deleteEmail,
      sendEmail,
      saveDraft,
      addContact,
      updateSettings,
      fetchEmails,
      addFolder,
    }),
    [folders, emails, contacts, settings, currentFolder, searchQuery]
  );

  return <MailContext.Provider value={value}>{children}</MailContext.Provider>;
}

export const useMail = () => {
  const context = useContext(MailContext);
  if (context === undefined) {
    throw new Error('useMail must be used within a MailProvider');
  }
  return context;
};
