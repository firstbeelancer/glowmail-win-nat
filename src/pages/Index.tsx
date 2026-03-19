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
  const { markAsRead, settings, sendEmail, currentFolder, emails } = useMail();

  // Get sorted email list for next/prev navigation
  const folderEmails = emails.filter(e => e.folderId === currentFolder)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const selectedIdx = selectedEmail ? folderEmails.findIndex(e => e.id === selectedEmail.id) : -1;
  const hasPrev = selectedIdx > 0;
  const hasNext = selectedIdx >= 0 && selectedIdx < folderEmails.length - 1;
  const handleNextEmail = () => {
    if (hasNext) {
      const next = folderEmails[selectedIdx + 1];
      handleSelectEmail(next);
    }
  };
  const handlePrevEmail = () => {
    if (hasPrev) {
      const prev = folderEmails[selectedIdx - 1];
      handleSelectEmail(prev);
    }
  };

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

  const escapeHtml = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const buildRenderableEmailBody = (full: any) => {
    const bodyHtml = typeof full?.bodyHtml === 'string' ? full.bodyHtml.trim() : '';
    const html = typeof full?.html === 'string' ? full.html.trim() : '';
    const bodyText = typeof full?.bodyText === 'string' ? full.bodyText.trim() : '';
    const text = typeof full?.text === 'string' ? full.text.trim() : '';

    const resolvedHtml = bodyHtml || html;
    const resolvedText = bodyText || text;
    const htmlHasTags = /<\/?[a-z][\s\S]*>/i.test(resolvedHtml);

    if (resolvedHtml && htmlHasTags) return resolvedHtml;
    if (resolvedText) {
      return `<div style="white-space: pre-wrap; line-height: 1.55;">${escapeHtml(resolvedText)}</div>`;
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
    const myEmail = settings.account.email;
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
        (c, index, self) => index === self.findIndex((t) => t.email === c.email) && c.email.toLowerCase() !== myEmail.toLowerCase()
      );
      cc = (email.cc || []).filter(c => c.email.toLowerCase() !== myEmail.toLowerCase());
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
    return <Login onLogin={(creds) => {
      localStorage.setItem('glowmail_credentials', JSON.stringify(creds));
      setLoggedIn(true);
    }} />;
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
