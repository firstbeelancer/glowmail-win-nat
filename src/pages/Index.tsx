import { useState } from 'react';
import { MailProvider, useMail } from '../store';
import { Layout } from '../components/glowmail/Layout';
import { EmailList } from '../components/glowmail/EmailList';
import { EmailDetail } from '../components/glowmail/EmailDetail';
import { Compose } from '../components/glowmail/Compose';
import { Email } from '../types';
import { Toaster } from 'react-hot-toast';
import { AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';

function MailApp() {
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [composeData, setComposeData] = useState<Partial<Email> | null>(null);
  const { markAsRead, settings, sendEmail } = useMail();

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

  const handleSelectEmail = (email: Email) => {
    setSelectedEmail(email);
    const delay = settings.markAsReadDelay ?? 0;
    if (delay > 0) {
      setTimeout(() => markAsRead(email.id), delay * 1000);
    } else {
      markAsRead(email.id);
    }
  };

  const handleReply = (type: 'reply' | 'replyAll' | 'forward', email: Email, quickReplyText?: string) => {
    let subject = email.subject;
    let to: any[] = [];
    let cc: any[] = [];

    // Build quoted header with full details
    const dateStr = new Date(email.date).toLocaleString();
    const fromStr = `${email.from.name} &lt;${email.from.email}&gt;`;
    const toStr = email.to.map(c => `${c.name} &lt;${c.email}&gt;`).join(', ');
    const ccStr = email.cc?.length ? email.cc.map(c => `${c.name} &lt;${c.email}&gt;`).join(', ') : '';
    
    let quoteHeader = `<p><b>${settings.language === 'ru' ? 'От' : 'From'}:</b> ${fromStr}<br>`;
    quoteHeader += `<b>${settings.language === 'ru' ? 'Кому' : 'To'}:</b> ${toStr}<br>`;
    if (ccStr) quoteHeader += `<b>${settings.language === 'ru' ? 'Копия' : 'Cc'}:</b> ${ccStr}<br>`;
    quoteHeader += `<b>${settings.language === 'ru' ? 'Дата' : 'Date'}:</b> ${dateStr}<br>`;
    quoteHeader += `<b>${settings.language === 'ru' ? 'Тема' : 'Subject'}:</b> ${email.subject}</p>`;

    let body = quickReplyText
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

  return (
    <Layout onCompose={() => setComposeData({})}>
      <div className="flex h-full relative">
        <div className="flex-1 flex flex-col min-w-0 border-r border-zinc-800/50">
          <EmailList onSelect={handleSelectEmail} onEditDraft={handleEditDraft} />
        </div>

        <div className="hidden lg:flex flex-[2] flex-col min-w-0 bg-zinc-950 relative">
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
              <div className="flex-1 flex flex-col items-center justify-center text-zinc-500">
                <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(255,255,255,0.02)]">
                  <svg className="w-8 h-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <p>{settings.language === 'ru' ? 'Выберите письмо для чтения' : 'Select an email to read'}</p>
              </div>
            )}
          </AnimatePresence>
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
  return (
    <MailProvider>
      <MailApp />
      <Toaster 
        position="bottom-center"
        toastOptions={{
          style: {
            background: '#18181b',
            color: '#f4f4f5',
            border: '1px solid #27272a',
          },
          success: {
            iconTheme: {
              primary: '#10b981',
              secondary: '#18181b',
            },
          },
        }}
      />
    </MailProvider>
  );
};

export default Index;
