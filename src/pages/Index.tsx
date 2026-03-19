import { useState, useEffect } from 'react';
import { MailProvider, useMail } from '../store';
import { Layout } from '../components/glowmail/Layout';
import { EmailList } from '../components/glowmail/EmailList';
import { EmailDetail } from '../components/glowmail/EmailDetail';
import { Compose } from '../components/glowmail/Compose';
import { Email } from '../types';
import { Toaster } from 'react-hot-toast';
import { AnimatePresence } from 'framer-motion';
import Login from './Login';
import * as mailApi from '../lib/mail-api';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';

function MailApp() {
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [composeData, setComposeData] = useState<Partial<Email> | null>(null);
  const { markAsRead, settings, sendEmail, currentFolder } = useMail();

  // Listen for messages from detached composer window
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'glowmail-compose') {
        const { to, subject, body } = event.data;
        const toContacts = to.split(',').map((email: string) => ({
          id: email.trim(),
          name: email.trim(),
          email: email.trim(),
        })).filter((c: any) => c.email);
        sendEmail({ to: toContacts, subject, body });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [sendEmail]);

  useEffect(() => {
    if (settings.theme === 'light') {
      document.documentElement.classList.add('light');
    } else if (settings.theme === 'dark') {
      document.documentElement.classList.remove('light');
    } else {
      if (window.matchMedia('(prefers-color-scheme: light)').matches) {
        document.documentElement.classList.add('light');
      } else {
        document.documentElement.classList.remove('light');
      }
    }
  }, [settings.theme]);

  useEffect(() => {
    const styleId = 'custom-fonts-style';
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    const fontFaces = settings.customFonts?.map(font => `
      @font-face {
        font-family: '${font.name}';
        src: url('${font.url}') format('woff2');
        font-weight: normal;
        font-style: normal;
      }
    `).join('\n') || '';

    styleEl.innerHTML = fontFaces;
  }, [settings.customFonts]);

  const stripInvisible = (value: string) => value
    .replace(/[\u200B-\u200D\uFEFF\u2060\u2800]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();

  const hasVisibleText = (value: string) => {
    const plain = value.replace(/<[^>]*>/g, ' ');
    return stripInvisible(plain).length > 0;
  };

  const looksCorruptedText = (value: string) => {
    if (!value) return false;
    const plain = value
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]*>/g, ' ');

    const controls = (plain.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
    if (controls > 2) return true;

    const replacement = (plain.match(/�/g) || []).length;
    if (replacement > 0) return true;

    const cyr = (plain.match(/[А-Яа-яЁё]/g) || []).length;
    const weird = (plain.match(/[@><;]{1}/g) || []).length;
    return cyr < 3 && weird > 24 && plain.length > 120;
  };

  const escapeHtml = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const decodeQuotedPrintable = (input: string, charset = 'utf-8') => {
    const clean = input.replace(/=\r?\n/g, '');
    const bytes: number[] = [];

    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      const hex = clean.slice(i + 1, i + 3);
      if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
      } else {
        bytes.push(clean.charCodeAt(i) & 0xff);
      }
    }

    try {
      const arr = new Uint8Array(bytes);
      try {
        return new TextDecoder(charset).decode(arr);
      } catch {
        return new TextDecoder('utf-8').decode(arr);
      }
    } catch {
      return clean;
    }
  };

  const normalizeBase64Input = (value: string) => {
    let compact = value.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    compact = compact.replace(/^[^A-Za-z0-9+/=]+/, '').replace(/[^A-Za-z0-9+/=]+$/, '');
    if (!compact) return compact;
    const remainder = compact.length % 4;
    if (remainder) compact += '='.repeat(4 - remainder);
    return compact;
  };

  const decodeBase64 = (input: string, charset = 'utf-8') => {
    try {
      const binary = atob(normalizeBase64Input(input));
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      try {
        return new TextDecoder(charset).decode(bytes);
      } catch {
        return new TextDecoder('utf-8').decode(bytes);
      }
    } catch {
      return input;
    }
  };

  const isLikelyBase64 = (value: string) => {
    const compact = normalizeBase64Input(value);
    if (compact.length < 24 || compact.length % 4 !== 0) return false;
    return /^[A-Za-z0-9+/=]+$/.test(compact);
  };

  const looksLikeQuotedPrintable = (value: string) => {
    const softBreaks = (value.match(/=\r?\n/g) || []).length;
    const hexEscapes = (value.match(/=[0-9A-Fa-f]{2}/g) || []).length;
    return hexEscapes >= 3 || (softBreaks > 0 && hexEscapes > 0);
  };

  const looksLikeMimeBlob = (value: string) => {
    const lower = value.toLowerCase();
    return lower.includes('content-type: multipart/') ||
      lower.includes('content-transfer-encoding:') ||
      /(?:^|\r?\n)--[^\r\n]{8,}/.test(value);
  };

  const parseMultipartBlob = (source: string): { text: string; html: string } => {
    const normalized = source.replace(/\r\n/g, '\n');
    const boundaryFromHeader = normalized.match(/boundary="?([^"\n;]+)"?/i)?.[1]?.trim();
    const boundaryFromBody = normalized.match(/(?:^|\n)--([^\n-][^\n]*)/)?.[1]?.trim();
    const boundary = boundaryFromHeader || boundaryFromBody;

    if (!boundary) return { text: '', html: '' };

    const parts = normalized.split(`--${boundary}`);
    let text = '';
    let html = '';

    for (const partRaw of parts) {
      const part = partRaw.trim();
      if (!part || part === '--') continue;

      const splitIdx = part.indexOf('\n\n');
      if (splitIdx === -1) continue;

      const headersRaw = part.slice(0, splitIdx);
      const headers = headersRaw.toLowerCase();
      const bodyRaw = part.slice(splitIdx + 2).replace(/\n--$/, '').trim();

      if (headers.includes('content-type: multipart/')) {
        const nested = parseMultipartBlob(bodyRaw);
        if (!text && nested.text) text = nested.text;
        if (!html && nested.html) html = nested.html;
        continue;
      }

      const charset = headers.match(/charset=["']?([^"'\s;]+)/i)?.[1] || 'utf-8';
      const isHtml = headers.includes('content-type: text/html');
      const isPlain = headers.includes('content-type: text/plain');
      if (!isHtml && !isPlain) continue;

      let decoded = bodyRaw;
      if (headers.includes('content-transfer-encoding: quoted-printable')) {
        decoded = decodeQuotedPrintable(bodyRaw, charset);
      } else if (headers.includes('content-transfer-encoding: base64') || isLikelyBase64(bodyRaw)) {
        decoded = decodeBase64(bodyRaw, charset);
      }

      if (isHtml && !html) {
        html = decoded;
      } else if (isPlain && !text) {
        text = decoded;
      }
    }

    return { text: text.trim(), html: html.trim() };
  };

  const decodeStandaloneBlob = (value: string): string => {
    if (!value) return value;

    let current = value;
    for (let i = 0; i < 3; i++) {
      let changed = false;

      if (looksLikeQuotedPrintable(current)) {
        const qpDecoded = decodeQuotedPrintable(current, 'utf-8');
        if (qpDecoded !== current) {
          current = qpDecoded;
          changed = true;
        }
      }

      if (isLikelyBase64(current)) {
        const b64Decoded = decodeBase64(current, 'utf-8');
        if (b64Decoded !== current) {
          current = b64Decoded;
          changed = true;
        }
      }

      if (!changed) break;
    }

    return current;
  };

  const buildRenderableEmailBody = (full: any) => {
    let bodyHtml = typeof full?.bodyHtml === 'string' ? full.bodyHtml : '';
    let bodyText = typeof full?.bodyText === 'string' ? full.bodyText : '';

    const parseFromCandidate = (candidate: string) => {
      if (!candidate || !looksLikeMimeBlob(candidate)) return;
      const parsed = parseMultipartBlob(candidate);
      if (parsed.html) bodyHtml = parsed.html;
      if (parsed.text && (!bodyText || looksLikeMimeBlob(bodyText))) bodyText = parsed.text;
    };

    parseFromCandidate(bodyHtml);
    parseFromCandidate(bodyText);

    bodyHtml = decodeStandaloneBlob(bodyHtml);
    bodyText = decodeStandaloneBlob(bodyText);

    if (looksLikeMimeBlob(bodyHtml)) {
      const reparsed = parseMultipartBlob(bodyHtml);
      if (reparsed.html) bodyHtml = reparsed.html;
      if (reparsed.text && !bodyText) bodyText = reparsed.text;
    }

    if (looksLikeMimeBlob(bodyText)) {
      const reparsed = parseMultipartBlob(bodyText);
      if (reparsed.html && !bodyHtml) bodyHtml = reparsed.html;
      if (reparsed.text) bodyText = reparsed.text;
    }

    if ((!bodyHtml || looksCorruptedText(bodyHtml)) && isLikelyBase64(bodyText)) {
      const decodedText = decodeBase64(bodyText, 'utf-8');
      if (/<\/?[a-z][\s\S]*>/i.test(decodedText)) {
        bodyHtml = decodedText;
        bodyText = '';
      } else {
        bodyText = decodedText;
      }
    }

    const compactHtml = normalizeBase64Input(bodyHtml);
    const looksLikeBase64Html =
      compactHtml.length > 256 &&
      compactHtml.length % 4 === 0 &&
      /^[A-Za-z0-9+/=]+$/.test(compactHtml) &&
      /^(PCFET0|PGh0bWw|PGRpdi|PHA|PHRhYmxl)/i.test(compactHtml);

    if (looksLikeBase64Html) {
      const decodedHtml = decodeBase64(compactHtml, 'utf-8');
      if (/<\/?[a-z][\s\S]*>/i.test(decodedHtml)) {
        bodyHtml = decodedHtml;
      }
    }

    const bodyTextLooksHtml = /<\/?[a-z][\s\S]*>/i.test(bodyText);
    if (bodyTextLooksHtml && (!bodyHtml || looksCorruptedText(bodyHtml)) && !looksCorruptedText(bodyText)) {
      bodyHtml = bodyText;
      bodyText = '';
    }

    const htmlHasTags = /<\/?[a-z][\s\S]*>/i.test(bodyHtml);
    bodyText = stripInvisible(bodyText);

    if (!htmlHasTags && hasVisibleText(bodyHtml) && !bodyText) {
      bodyText = stripInvisible(bodyHtml);
      bodyHtml = '';
    }

    if (hasVisibleText(bodyHtml) && htmlHasTags && !looksLikeMimeBlob(bodyHtml) && !looksCorruptedText(bodyHtml)) return bodyHtml;
    if (hasVisibleText(bodyText)) {
      return `<div style="white-space: pre-wrap; line-height: 1.55;">${escapeHtml(bodyText)}</div>`;
    }

    return settings.language === 'ru'
      ? '<p style="opacity:0.7">Текст письма не удалось загрузить.</p>'
      : '<p style="opacity:0.7">Could not load email text.</p>';
  };

  const handleSelectEmail = async (email: Email) => {
    setSelectedEmail(email);
    const delay = settings.markAsReadDelay ?? 0;
    if (delay > 0) {
      setTimeout(() => markAsRead(email.id), delay * 1000);
    } else {
      markAsRead(email.id);
    }

    // Fetch full body from IMAP if not already loaded
    if (!email.body) {
      try {
        const full = await mailApi.fetchEmailBody(currentFolder, Number(email.id));
        const enriched = {
          ...email,
          body: buildRenderableEmailBody(full),
          read: true,
        };
        setSelectedEmail(enriched);
      } catch (e) {
        console.error('Failed to fetch email body:', e);
      }
    }
  };

  const handleReply = (type: 'reply' | 'replyAll' | 'forward', email: Email, quickReplyText?: string) => {
    let subject = email.subject;
    let to: any[] = [];
    let cc: any[] = [];

    const dateStr = new Date(email.date).toLocaleString();
    const fromStr = `${email.from.name} &lt;${email.from.email}&gt;`;
    const toStr = email.to.map(c => `${c.name} &lt;${c.email}&gt;`).join(', ');
    const ccStr = email.cc?.length ? email.cc.map(c => `${c.name} &lt;${c.email}&gt;`).join(', ') : '';

    let quoteHeader = `<p><b>${settings.language === 'ru' ? 'От' : 'From'}:</b> ${fromStr}<br>`;
    quoteHeader += `<b>${settings.language === 'ru' ? 'Кому' : 'To'}:</b> ${toStr}<br>`;
    if (ccStr) quoteHeader += `<b>${settings.language === 'ru' ? 'Копия' : 'Cc'}:</b> ${ccStr}<br>`;
    quoteHeader += `<b>${settings.language === 'ru' ? 'Дата' : 'Date'}:</b> ${dateStr}<br>`;
    quoteHeader += `<b>${settings.language === 'ru' ? 'Тема' : 'Subject'}:</b> ${email.subject}</p>`;

    const body = quickReplyText
      ? `<p>${quickReplyText}</p><br><br><hr>${quoteHeader}<blockquote>${email.body}</blockquote>`
      : `<br><br><hr>${quoteHeader}<blockquote>${email.body}</blockquote>`;

    if (type === 'reply') {
      subject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
      to = [email.from];
    } else if (type === 'replyAll') {
      subject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
      to = [email.from, ...email.to].filter(
        (c, index, self) => index === self.findIndex((t) => t.email === c.email) && c.email !== 'me@example.com'
      );
      cc = (email.cc || []).filter(c => c.email !== 'me@example.com');
    } else if (type === 'forward') {
      subject = subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`;
      to = [];
    }

    setComposeData({ to, cc, subject, body });
  };

  const handleEditDraft = (email: Email) => {
    setComposeData({
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
      subject: email.subject,
      body: email.body,
      id: email.id,
    });
  };

  const renderEmailDetail = () => (
    <AnimatePresence mode="wait">
      {selectedEmail ? (
        <EmailDetail
          key={selectedEmail.id}
          email={selectedEmail}
          onBack={() => setSelectedEmail(null)}
          onReply={handleReply}
          onEditDraft={handleEditDraft}
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 h-full">
          <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(255,255,255,0.02)]">
            <svg className="w-8 h-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <p>{settings.language === 'ru' ? 'Выберите письмо для чтения' : 'Select an email to read'}</p>
        </div>
      )}
    </AnimatePresence>
  );

  const layoutMode = settings.layoutMode || 'vertical';

  return (
    <Layout onCompose={(prefill) => {
      if (prefill?.to) {
        setComposeData({ to: [{ id: prefill.to, name: prefill.to.split('@')[0], email: prefill.to }] });
      } else {
        setComposeData({});
      }
    }}>
      <div className="flex h-full relative">
        {/* Desktop layout */}
        <div className="hidden lg:flex flex-1 min-w-0 relative">
          {layoutMode === 'vertical' ? (
            <ResizablePanelGroup direction="horizontal" className="h-full">
              <ResizablePanel defaultSize={35} minSize={25} maxSize={50}>
                <EmailList onSelect={handleSelectEmail} onEditDraft={handleEditDraft} selectedEmailId={selectedEmail?.id} />
              </ResizablePanel>
              <ResizableHandle withHandle className="bg-zinc-800/50 hover:bg-emerald-500/30 transition-colors data-[resize-handle-active]:bg-emerald-500/50" />
              <ResizablePanel defaultSize={65} minSize={40}>
                <div className="h-full flex flex-col bg-zinc-950 relative">
                  {renderEmailDetail()}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <ResizablePanelGroup direction="vertical" className="h-full">
              <ResizablePanel defaultSize={40} minSize={20} maxSize={70}>
                <EmailList onSelect={handleSelectEmail} onEditDraft={handleEditDraft} selectedEmailId={selectedEmail?.id} />
              </ResizablePanel>
              <ResizableHandle withHandle className="bg-zinc-800/50 hover:bg-emerald-500/30 transition-colors data-[resize-handle-active]:bg-emerald-500/50" />
              <ResizablePanel defaultSize={60} minSize={25}>
                <div className="h-full flex flex-col bg-zinc-950 relative">
                  {renderEmailDetail()}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>

        {/* Mobile: stacked */}
        <div className="lg:hidden flex-1 flex flex-col min-w-0">
          <EmailList onSelect={handleSelectEmail} onEditDraft={handleEditDraft} selectedEmailId={selectedEmail?.id} />
        </div>

        <div className="lg:hidden">
          <AnimatePresence>
            {selectedEmail && (
              <EmailDetail
                key={selectedEmail.id}
                email={selectedEmail}
                onBack={() => setSelectedEmail(null)}
                onReply={handleReply}
                onEditDraft={handleEditDraft}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {composeData !== null && (
          <Compose
            initialData={composeData}
            onClose={() => setComposeData(null)}
          />
        )}
      </AnimatePresence>
    </Layout>
  );
}

const Index = () => {
  const [loggedIn, setLoggedIn] = useState(() => {
    return !!localStorage.getItem('glowmail_credentials');
  });

  if (!loggedIn) {
    return (
      <Login onLogin={(creds) => {
        localStorage.setItem('glowmail_credentials', JSON.stringify(creds));
        setLoggedIn(true);
      }} />
    );
  }

  return (
    <MailProvider>
      <MailAppWithCreds />
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: 'hsl(var(--zinc-900))',
            color: 'hsl(var(--zinc-100))',
            border: '1px solid hsl(var(--zinc-800))',
          },
          success: {
            iconTheme: {
              primary: 'hsl(var(--primary))',
              secondary: 'hsl(var(--zinc-900))',
            },
          },
        }}
      />
    </MailProvider>
  );
};

/** Wrapper that applies saved credentials to the store on mount */
function MailAppWithCreds() {
  const { updateSettings } = useMail();

  useEffect(() => {
    const raw = localStorage.getItem('glowmail_credentials');
    if (raw) {
      try {
        const creds = JSON.parse(raw);
        updateSettings({
          account: { name: creds.name, email: creds.email },
          server: {
            imapHost: creds.imapHost,
            imapPort: creds.imapPort,
            smtpHost: creds.smtpHost,
            smtpPort: creds.smtpPort,
            secure: true,
            authMethod: 'app-password',
          },
        });
      } catch {
        // ignore broken stored creds
      }
    }
  }, []);

  return <MailApp />;
}

export default Index;
