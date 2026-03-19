import { useState } from 'react';
import { motion } from 'framer-motion';
import loginBg from '@/assets/login-bg.png';

type LoginCredentials = {
  email: string;
  password: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  name: string;
};

const PRESETS: Record<string, { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }> = {
  'gmail.com': { imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465 },
  'yandex.ru': { imapHost: 'imap.yandex.ru', imapPort: 993, smtpHost: 'smtp.yandex.ru', smtpPort: 465 },
  'yandex.com': { imapHost: 'imap.yandex.com', imapPort: 993, smtpHost: 'smtp.yandex.com', smtpPort: 465 },
  'mail.ru': { imapHost: 'imap.mail.ru', imapPort: 993, smtpHost: 'smtp.mail.ru', smtpPort: 465 },
  'outlook.com': { imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587 },
  'hotmail.com': { imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587 },
  'icloud.com': { imapHost: 'imap.mail.me.com', imapPort: 993, smtpHost: 'smtp.mail.me.com', smtpPort: 587 },
  'yahoo.com': { imapHost: 'imap.mail.yahoo.com', imapPort: 993, smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465 },
};

function detectPreset(email: string) {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? PRESETS[domain] : undefined;
}

export default function Login({ onLogin }: { onLogin: (creds: LoginCredentials) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState(993);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(465);
  const [loading, setLoading] = useState(false);

  const preset = detectPreset(email);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const finalImap = imapHost || preset?.imapHost || '';
    const finalSmtp = smtpHost || preset?.smtpHost || '';
    const finalImapPort = imapHost ? imapPort : (preset?.imapPort || 993);
    const finalSmtpPort = smtpHost ? smtpPort : (preset?.smtpPort || 465);

    onLogin({
      email,
      password,
      name: name || email.split('@')[0],
      imapHost: finalImap,
      imapPort: finalImapPort,
      smtpHost: finalSmtp,
      smtpPort: finalSmtpPort,
    });
  };

  const detectedProvider = preset ? (email.split('@')[1]) : null;

  return (
    <div className="min-h-screen w-full flex flex-col items-end justify-end pb-12 relative overflow-hidden">
      {/* Background */}
      <img
        src={loginBg}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />

      {/* Login card */}
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur-xl shadow-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Имя</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Как вас зовут?"
                className="w-full h-11 rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full h-11 rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition"
              />
              {detectedProvider && (
                <p className="text-xs text-primary/80 mt-1.5 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  Серверы {detectedProvider} определены автоматически
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Пароль приложения</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full h-11 rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition"
              />
              <p className="text-xs text-neutral-500 mt-1">
                Используйте пароль приложения, а не основной пароль
              </p>
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-neutral-400 hover:text-neutral-200 transition flex items-center gap-1"
            >
              <svg className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Настройки сервера
            </button>

            {showAdvanced && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-3 overflow-hidden"
              >
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs text-neutral-500 mb-1">IMAP сервер</label>
                    <input
                      type="text"
                      value={imapHost}
                      onChange={(e) => setImapHost(e.target.value)}
                      placeholder={preset?.imapHost || 'imap.example.com'}
                      className="w-full h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:border-primary/50 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">Порт</label>
                    <input
                      type="number"
                      value={imapHost ? imapPort : (preset?.imapPort || 993)}
                      onChange={(e) => setImapPort(Number(e.target.value))}
                      className="w-full h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white focus:outline-none focus:border-primary/50 transition"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs text-zinc-500 mb-1">SMTP сервер</label>
                    <input
                      type="text"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      placeholder={preset?.smtpHost || 'smtp.example.com'}
                      className="w-full h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-primary/50 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Порт</label>
                    <input
                      type="number"
                      value={smtpHost ? smtpPort : (preset?.smtpPort || 465)}
                      onChange={(e) => setSmtpPort(Number(e.target.value))}
                      className="w-full h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-zinc-100 focus:outline-none focus:border-primary/50 transition"
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>
                  Войти
                </>
              )}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
