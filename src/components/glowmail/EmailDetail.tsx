import React, { useState, useEffect } from 'react';
import { Email } from '../../types';
import { useMail } from '../../store';
import { format } from 'date-fns';
import { ArrowLeft, Reply, ReplyAll, Forward, MoreVertical, Star, Paperclip, Download, Trash2, Tag, File, Image as ImageIcon, FileText, AlertTriangle, Sparkles, Loader2, Edit3, Printer, FolderInput, Copy, ChevronUp, ChevronDown, Mail, MailOpen, Code, ClipboardCopy, ChevronRight, ExternalLink, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { t, translateFolderName } from '@/lib/i18n';
import { EmailHtmlViewer, EmailTextViewer } from './EmailHtmlViewer';
import toast from 'react-hot-toast';
import { sendToTigerMediaHub } from '@/lib/mail-api';

export const EmailDetail: React.FC<{
  email: Email;
  onBack: () => void;
  onReply: (type: 'reply' | 'replyAll' | 'forward', email: Email, quickReplyText?: string) => void;
  onEditDraft?: (email: Email) => void;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
}> = ({ email, onBack, onReply, onEditDraft, onNext, onPrev, hasNext, hasPrev }) => {
  const { toggleStar, deleteEmail, settings, updateEmailTags, moveEmailToFolder, copyEmailToFolder, allFoldersFlat, currentFolder, markAsRead, markAsUnread } = useMail();
  const lang = settings.language;
  const [showHeaders, setShowHeaders] = useState(false);
  const [showRawSource, setShowRawSource] = useState(false);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [isGeneratingReplies, setIsGeneratingReplies] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [showCopyPicker, setShowCopyPicker] = useState(false);
  const [tmhSendingId, setTmhSendingId] = useState<string | null>(null);
  const [tmhFolderPrompt, setTmhFolderPrompt] = useState<{ attId: string; folder: string } | null>(null);

  // Keyboard shortcuts for next/prev
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); onNext?.(); }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); onPrev?.(); }
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); onReply('reply', email); }
      if (e.key === 'a' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); onReply('replyAll', email); }
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); onReply('forward', email); }
      if (e.key === 'Escape') { e.preventDefault(); onBack(); }
      if (e.key === 'u') { e.preventDefault(); markAsUnread(email.id); onBack(); }
      if (e.key === '#' || e.key === 'Delete') { e.preventDefault(); deleteEmail(email.id); onBack(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [email.id, onNext, onPrev, onBack, onReply, markAsUnread, deleteEmail]);

  useEffect(() => {
    let cancelled = false;
    const generateReplies = async () => {
      setIsGeneratingReplies(true);
      setQuickReplies([]);
      try {
        const { callEmailAI } = await import('@/lib/ai');
        const result = await callEmailAI({
          action: 'quick_replies',
          emailBody: email.body,
          emailSubject: email.subject,
          emailFrom: email.from.name,
        });
        if (!cancelled) {
          try {
            const parsed = JSON.parse(result);
            if (Array.isArray(parsed)) setQuickReplies(parsed);
          } catch {
            setQuickReplies([]);
          }
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setIsGeneratingReplies(false);
      }
    };
    if (email.folderId !== 'drafts' && email.folderId !== 'sent' && settings.aiEnabled) {
      generateReplies();
    }
    return () => { cancelled = true; };
  }, [email.id]);

  const getTagColor = (tagName: string) => {
    const tagDef = settings.availableTags.find(t => t.name === tagName);
    return tagDef ? tagDef.color : '#10b981';
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html><head><title>${email.subject}</title><style>body{font-family:sans-serif;padding:20px;color:#222;}h1{font-size:18px;}p{margin:4px 0;}.meta{color:#666;font-size:13px;}</style></head><body>
        <h1>${email.subject}</h1>
        <p class="meta">From: ${email.from.name} &lt;${email.from.email}&gt;</p>
        <p class="meta">To: ${email.to.map(t => `${t.name} &lt;${t.email}&gt;`).join(', ')}</p>
        <p class="meta">Date: ${new Date(email.date).toLocaleString()}</p>
        <hr/>${email.body}
        </body></html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  const handleSave = () => {
    const { buildEml } = (() => {
      const boundary = '----=_Part_' + Math.random().toString(36).slice(2);
      const dateStr = new Date(email.date).toUTCString();
      const lines: string[] = [];
      lines.push(`Message-ID: ${email.headers.messageId}`);
      if (email.headers.inReplyTo) lines.push(`In-Reply-To: ${email.headers.inReplyTo}`);
      if (email.headers.references) lines.push(`References: ${email.headers.references}`);
      if (email.headers.returnPath) lines.push(`Return-Path: ${email.headers.returnPath}`);
      if (email.headers.received) email.headers.received.forEach(r => lines.push(`Received: ${r}`));
      lines.push(`Date: ${dateStr}`);
      lines.push(`From: ${email.from.name} <${email.from.email}>`);
      lines.push(`To: ${email.to.map(t => `${t.name} <${t.email}>`).join(', ')}`);
      if (email.cc?.length) lines.push(`Cc: ${email.cc.map(c => `${c.name} <${c.email}>`).join(', ')}`);
      if (email.bcc?.length) lines.push(`Bcc: ${email.bcc.map(b => `${b.name} <${b.email}>`).join(', ')}`);
      lines.push(`Subject: ${email.subject}`);
      lines.push(`MIME-Version: 1.0`);
      lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
      if (email.importance === 'high') lines.push(`Importance: high`);
      lines.push('');
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: text/html; charset="UTF-8"`);
      lines.push(`Content-Transfer-Encoding: quoted-printable`);
      lines.push('');
      lines.push(email.body);
      lines.push('');
      lines.push(`--${boundary}--`);
      return { buildEml: lines.join('\r\n') };
    })();
    const blob = new Blob([buildEml], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${email.subject || 'email'}.eml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(lang === 'ru' ? `${label} скопировано` : `${label} copied`);
    });
  };

  // Check if email body contains external sender (different domain)
  const userDomain = settings.account.email.split('@')[1];
  const senderDomain = email.from.email.split('@')[1];
  const isExternalSender = userDomain && senderDomain && userDomain !== senderDomain;

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
      className="absolute inset-0 bg-zinc-950 z-20 flex flex-col h-full overflow-hidden"
    >
      {/* Top Bar */}
      <header className="h-14 border-b border-zinc-800/50 flex items-center justify-between px-3 bg-zinc-950/80 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-full hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          {/* Next/Prev navigation */}
          <div className="hidden sm:flex items-center gap-0.5 ml-1">
            <button
              onClick={onPrev}
              disabled={!hasPrev}
              className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={lang === 'ru' ? 'Предыдущее (k)' : 'Previous (k)'}
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              onClick={onNext}
              disabled={!hasNext}
              className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={lang === 'ru' ? 'Следующее (j)' : 'Next (j)'}
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
          <div className="w-px h-5 bg-zinc-800 mx-1 hidden sm:block" />
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => toggleStar(email.id)}
              className="p-1.5 rounded-full hover:bg-zinc-800 transition-colors"
            >
              <Star
                className={cn(
                  "w-4 h-4 transition-all",
                  email.starred ? "fill-yellow-500 text-yellow-500 drop-shadow-[0_0_8px_rgba(234,179,8,0.5)]" : "text-zinc-400"
                )}
              />
            </button>
            <button
              onClick={() => { email.read ? markAsUnread(email.id) : markAsRead(email.id); }}
              className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors"
              title={email.read ? (lang === 'ru' ? 'Отметить непрочитанным (u)' : 'Mark unread (u)') : (lang === 'ru' ? 'Отметить прочитанным' : 'Mark read')}
            >
              {email.read ? <Mail className="w-4 h-4" /> : <MailOpen className="w-4 h-4" />}
            </button>
            <button
              onClick={handleSave}
              className="hidden sm:block p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors"
              title={t('emailDetail.saveEmail', lang)}
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={handlePrint}
              className="hidden sm:block p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors"
              title={t('emailDetail.print', lang)}
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                deleteEmail(email.id);
                onBack();
              }}
              className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          {/* Tag picker in toolbar */}
          <div className="relative ml-1 hidden sm:block">
            <button
              onClick={() => setShowTagPicker(!showTagPicker)}
              className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors"
              title={t('compose.tagsLabel', lang)}
            >
              <Tag className="w-4 h-4" />
            </button>
            {showTagPicker && (
              <div className="absolute left-0 top-full mt-1 w-44 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50">
                <div className="p-1.5 flex flex-col max-h-52 overflow-y-auto">
                  {settings.availableTags.map(tag => {
                    const isActive = email.tags.includes(tag.name);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => {
                          const newTags = isActive
                            ? email.tags.filter(t2 => t2 !== tag.name)
                            : [...email.tags, tag.name];
                          updateEmailTags(email.id, newTags);
                        }}
                        className={cn(
                          "flex items-center gap-2 text-left px-3 py-1.5 text-xs rounded-lg transition-colors",
                          isActive ? "bg-zinc-800 text-emerald-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        )}
                      >
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                        {tag.name}
                        {isActive && <span className="ml-auto text-emerald-400">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {email.folderId === 'drafts' && onEditDraft && (
            <button
              onClick={() => onEditDraft(email)}
              className="px-3 py-1.5 mr-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <Edit3 className="w-4 h-4" />
              <span className="hidden sm:inline">{t('emailDetail.editFurther', lang)}</span>
            </button>
          )}
          <button
            onClick={() => onReply('reply', email)}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
            title={`${lang === 'ru' ? 'Ответить' : 'Reply'} (r)`}
          >
            <Reply className="w-5 h-5" />
          </button>
          <button
            onClick={() => onReply('replyAll', email)}
            className="hidden sm:block p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
            title={`${lang === 'ru' ? 'Ответить всем' : 'Reply All'} (a)`}
          >
            <ReplyAll className="w-5 h-5" />
          </button>
          <button
            onClick={() => onReply('forward', email)}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
            title={`${lang === 'ru' ? 'Переслать' : 'Forward'} (f)`}
          >
            <Forward className="w-5 h-5" />
          </button>
          {/* More actions menu */}
          <div className="relative">
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
              title={t('emailDetail.moreActions', lang)}
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            {showMoreMenu && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50">
                <div className="p-1 flex flex-col">
                  <button
                    onClick={() => { handleSave(); setShowMoreMenu(false); }}
                    className="flex items-center gap-2 text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    {t('emailList.save', lang)}
                  </button>
                  <button
                    onClick={() => { handlePrint(); setShowMoreMenu(false); }}
                    className="flex items-center gap-2 text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    {t('emailList.print', lang)}
                  </button>
                  <div className="h-px bg-zinc-800 my-1" />
                  {/* Copy email address */}
                  <button
                    onClick={() => { copyToClipboard(email.from.email, 'Email'); setShowMoreMenu(false); }}
                    className="flex items-center gap-2 text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors"
                  >
                    <ClipboardCopy className="w-4 h-4" />
                    {lang === 'ru' ? 'Копировать адрес' : 'Copy email address'}
                  </button>
                  {/* Copy message-id */}
                  {email.headers.messageId && (
                    <button
                      onClick={() => { copyToClipboard(email.headers.messageId, 'Message-ID'); setShowMoreMenu(false); }}
                      className="flex items-center gap-2 text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors"
                    >
                      <Code className="w-4 h-4" />
                      {lang === 'ru' ? 'Копировать Message-ID' : 'Copy Message-ID'}
                    </button>
                  )}
                  {/* Show raw source */}
                  <button
                    onClick={() => { setShowRawSource(!showRawSource); setShowMoreMenu(false); }}
                    className="flex items-center gap-2 text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    {lang === 'ru' ? (showRawSource ? 'Скрыть исходник' : 'Показать исходник') : (showRawSource ? 'Hide source' : 'Show source')}
                  </button>
                  <div className="h-px bg-zinc-800 my-1" />
                  <div className="relative">
                    <button
                      onClick={() => { setShowMovePicker(!showMovePicker); setShowCopyPicker(false); }}
                      className="flex items-center gap-2 text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors w-full"
                    >
                      <FolderInput className="w-4 h-4" />
                      {lang === 'ru' ? 'Переместить' : 'Move to'}
                    </button>
                    {showMovePicker && (
                      <div className="absolute right-full top-0 mr-1 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50 max-h-60 overflow-y-auto">
                        <div className="p-1 flex flex-col">
                          {allFoldersFlat.filter(f => f.id !== currentFolder).map(f => (
                            <button
                              key={f.id}
                              onClick={() => {
                                moveEmailToFolder(email.id, f.id);
                                setShowMoreMenu(false);
                                setShowMovePicker(false);
                                onBack();
                              }}
                              className="flex items-center gap-2 text-left px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors"
                            >
                              {translateFolderName(f.id, f.name, lang)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <button
                      onClick={() => { setShowCopyPicker(!showCopyPicker); setShowMovePicker(false); }}
                      className="flex items-center gap-2 text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors w-full"
                    >
                      <Copy className="w-4 h-4" />
                      {lang === 'ru' ? 'Копировать' : 'Copy to'}
                    </button>
                    {showCopyPicker && (
                      <div className="absolute right-full top-0 mr-1 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50 max-h-60 overflow-y-auto">
                        <div className="p-1 flex flex-col">
                          {allFoldersFlat.filter(f => f.id !== currentFolder).map(f => (
                            <button
                              key={f.id}
                              onClick={() => {
                                copyEmailToFolder(email.id, f.id);
                                setShowMoreMenu(false);
                                setShowCopyPicker(false);
                              }}
                              className="flex items-center gap-2 text-left px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors"
                            >
                              {translateFolderName(f.id, f.name, lang)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
          {/* External sender warning */}
          {isExternalSender && (
            <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/5 border border-yellow-500/20 text-yellow-500 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {lang === 'ru' ? `Внешний отправитель (${senderDomain})` : `External sender (${senderDomain})`}
            </div>
          )}

          <div className="flex items-center gap-3 mb-6">
            {email.importance === 'high' && (
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-500/10 border border-red-500/30 text-red-400" title="High Importance">
                <AlertTriangle className="w-4 h-4" />
              </div>
            )}
            <h1 className="text-2xl font-bold text-zinc-100 tracking-tight flex-1">
              {email.subject}
            </h1>
          </div>

          <div className="flex items-start justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-zinc-950 font-bold shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                {email.from.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-zinc-100">{email.from.name}</span>
                  <button
                    onClick={() => copyToClipboard(email.from.email, 'Email')}
                    className="text-sm text-zinc-500 hover:text-emerald-400 transition-colors cursor-pointer"
                    title={lang === 'ru' ? 'Копировать адрес' : 'Copy address'}
                  >
                    &lt;{email.from.email}&gt;
                  </button>
                  <span className="hidden md:inline text-sm text-zinc-500">
                    {format(new Date(email.date), 'MMM d, yyyy, h:mm a')}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
                  <span>to {email.to.map((t) => t.name).join(', ')}</span>
                  <button
                    onClick={() => setShowHeaders(!showHeaders)}
                    className="hover:text-emerald-400 transition-colors hover:underline"
                  >
                    {showHeaders ? t('emailDetail.hideDetails', lang) : t('emailDetail.showDetails', lang)}
                  </button>
                </div>
                <span className="md:hidden text-xs text-zinc-500 mt-1 block">
                  {format(new Date(email.date), 'MMM d, yyyy, h:mm a')}
                </span>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {showHeaders && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mb-8 overflow-hidden"
              >
                <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-400 space-y-2">
                  <div className="grid grid-cols-[100px_1fr] gap-2">
                    <span className="text-zinc-500">From:</span>
                    <span>{email.from.name} &lt;{email.from.email}&gt;</span>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] gap-2">
                    <span className="text-zinc-500">To:</span>
                    <span>{email.to.map((t) => `${t.name} <${t.email}>`).join(', ')}</span>
                  </div>
                  {email.cc && email.cc.length > 0 && (
                    <div className="grid grid-cols-[100px_1fr] gap-2">
                      <span className="text-zinc-500">Cc:</span>
                      <span>{email.cc.map((t) => `${t.name} <${t.email}>`).join(', ')}</span>
                    </div>
                  )}
                  {email.bcc && email.bcc.length > 0 && (
                    <div className="grid grid-cols-[100px_1fr] gap-2">
                      <span className="text-zinc-500">Bcc:</span>
                      <span>{email.bcc.map((t) => `${t.name} <${t.email}>`).join(', ')}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-[100px_1fr] gap-2">
                    <span className="text-zinc-500">Date:</span>
                    <span>{new Date(email.date).toString()}</span>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] gap-2">
                    <span className="text-zinc-500">Message-ID:</span>
                    <span className="flex items-center gap-1">
                      <span className="break-all">{email.headers.messageId}</span>
                      <button onClick={() => copyToClipboard(email.headers.messageId, 'Message-ID')} className="p-0.5 hover:text-emerald-400 shrink-0">
                        <ClipboardCopy className="w-3 h-3" />
                      </button>
                    </span>
                  </div>
                  {email.headers.inReplyTo && (
                    <div className="grid grid-cols-[100px_1fr] gap-2">
                      <span className="text-zinc-500">In-Reply-To:</span>
                      <span className="break-all">{email.headers.inReplyTo}</span>
                    </div>
                  )}
                  {email.headers.references && (
                    <div className="grid grid-cols-[100px_1fr] gap-2">
                      <span className="text-zinc-500">References:</span>
                      <span className="break-all">{email.headers.references}</span>
                    </div>
                  )}
                  {email.headers.returnPath && (
                    <div className="grid grid-cols-[100px_1fr] gap-2">
                      <span className="text-zinc-500">Return-Path:</span>
                      <span>{email.headers.returnPath}</span>
                    </div>
                  )}
                  {email.headers.received && email.headers.received.length > 0 && (
                    <div className="grid grid-cols-[100px_1fr] gap-2">
                      <span className="text-zinc-500">Received:</span>
                      <div className="space-y-1">
                        {email.headers.received.map((r, i) => (
                          <div key={i} className="text-[11px] break-all">{r}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Raw source view */}
          <AnimatePresence>
            {showRawSource && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mb-8 overflow-hidden"
              >
                <div className="p-4 bg-zinc-900/80 border border-zinc-800 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-zinc-400">{lang === 'ru' ? 'Исходный HTML' : 'Raw HTML Source'}</span>
                    <button
                      onClick={() => copyToClipboard(email.body, 'Source')}
                      className="text-xs text-zinc-500 hover:text-emerald-400 flex items-center gap-1 transition-colors"
                    >
                      <ClipboardCopy className="w-3 h-3" />
                      {lang === 'ru' ? 'Копировать' : 'Copy'}
                    </button>
                  </div>
                  <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap break-all max-h-96 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                    {email.body}
                  </pre>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {email.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-8">
              {email.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-zinc-900 border border-zinc-800 text-zinc-300"
                >
                  <Tag className="w-3 h-3" style={{ color: getTagColor(tag), filter: `drop-shadow(0 0 5px ${getTagColor(tag)}80)` }} />
                  {tag}
                </span>
              ))}
            </div>
          )}

          {(() => {
            const body = email.body || '';
            const hasHtmlTags = /<\/?[a-z][\s\S]*>/i.test(body);
            if (hasHtmlTags) {
              return (
                <div className="rounded-xl overflow-hidden border border-zinc-800/50 shadow-sm">
                  <EmailHtmlViewer html={body} />
                </div>
              );
            }
            if (body.trim()) {
              return (
                <div className="rounded-xl overflow-hidden border border-zinc-800/50 shadow-sm">
                  <EmailTextViewer text={body} />
                </div>
              );
            }
            return (
              <p className="text-zinc-500 text-sm italic">
                {settings.language === 'ru' ? 'Письмо загружается....Оставайтесь на связи' : 'Email is loading....Stay tuned'}
              </p>
            );
          })()}

          {email.attachments.length > 0 && (
            <div className="mt-12 pt-8 border-t border-zinc-800/50">
              <h3 className="text-sm font-medium text-zinc-400 mb-4 flex items-center gap-2">
                <Paperclip className="w-4 h-4" />
                {t('emailDetail.attachments', lang)} ({email.attachments.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {email.attachments.map((att) => {
                  const isImage = att.type.startsWith('image/');
                  const isPdf = att.type === 'application/pdf';
                  
                  return (
                    <div
                      key={att.id}
                      className="group relative flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/80 transition-all overflow-hidden cursor-pointer"
                    >
                      <div className="h-32 bg-zinc-900/50 border-b border-zinc-800/50 flex items-center justify-center relative overflow-hidden">
                        {isImage ? (
                          <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center">
                            <ImageIcon className="w-8 h-8 text-zinc-600" />
                          </div>
                        ) : isPdf ? (
                          <FileText className="w-10 h-10 text-red-400/80" />
                        ) : (
                          <File className="w-10 h-10 text-zinc-500" />
                        )}
                        
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-[2px]">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (att.url) {
                                const a = document.createElement('a');
                                a.href = att.url;
                                a.download = att.name;
                                a.click();
                              } else {
                                toast(lang === 'ru' ? 'Файл недоступен для скачивания' : 'File not available for download', { icon: '⚠️' });
                              }
                            }}
                            className="p-2 bg-zinc-900/80 rounded-full text-zinc-200 hover:text-emerald-400 hover:scale-110 transition-all shadow-lg"
                            title={lang === 'ru' ? 'Скачать' : 'Download'}
                          >
                            <Download className="w-5 h-5" />
                          </button>
                          {settings.tigerMediaHub?.enabled && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const tmh = settings.tigerMediaHub;
                                if (!tmh?.projectUrl || !tmh?.apiKey || !tmh?.userId) {
                                  toast.error(t('tmh.notConfigured', lang));
                                  return;
                                }
                                if (!att.url) {
                                  toast(lang === 'ru' ? 'Файл ещё не загружен' : 'File not loaded yet', { icon: '⚠️' });
                                  return;
                                }
                                setTmhFolderPrompt({ attId: att.id, folder: tmh.defaultFolder || '' });
                              }}
                              disabled={tmhSendingId === att.id}
                              className="p-2 bg-zinc-900/80 rounded-full text-zinc-200 hover:text-orange-400 hover:scale-110 transition-all shadow-lg disabled:opacity-50"
                              title={t('tmh.sendToTmh', lang)}
                            >
                              {tmhSendingId === att.id ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : (
                                <Upload className="w-5 h-5" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                      
                      <div className="p-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-200 truncate" title={att.name}>{att.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-zinc-500 uppercase tracking-wider">{att.type.split('/')[1] || 'FILE'}</span>
                            <span className="w-1 h-1 rounded-full bg-zinc-700" />
                            <span className="text-xs text-zinc-500">{(att.size / 1024).toFixed(1)} KB</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* AI Quick Replies */}
          {settings.aiEnabled && email.folderId !== 'drafts' && email.folderId !== 'sent' && (
            <div className="mt-12 pt-8 border-t border-zinc-800/50">
              <h3 className="text-sm font-medium text-emerald-400 mb-4 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                {t('emailDetail.aiReplies', lang)}
                {isGeneratingReplies && <Loader2 className="w-3 h-3 animate-spin text-emerald-500/50" />}
              </h3>
              <div className="flex flex-wrap gap-3">
                {quickReplies.map((reply, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      onReply('reply', email, reply);
                    }}
                    className="px-4 py-2 bg-zinc-900/50 border border-zinc-800 hover:border-emerald-500/50 hover:bg-emerald-500/10 text-zinc-300 hover:text-emerald-400 rounded-xl text-sm font-medium transition-all shadow-sm hover:shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                  >
                    {reply}
                  </button>
                ))}
                {!isGeneratingReplies && quickReplies.length === 0 && (
                  <span className="text-sm text-zinc-500">{t('emailDetail.generating', lang)}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile next/prev bar */}
      <div className="sm:hidden h-12 border-t border-zinc-800/50 flex items-center justify-between px-4 bg-zinc-950 shrink-0">
        <button
          onClick={onPrev}
          disabled={!hasPrev}
          className="flex items-center gap-1 text-sm text-zinc-400 disabled:opacity-30"
        >
          <ChevronUp className="w-4 h-4" />
          {lang === 'ru' ? 'Пред.' : 'Prev'}
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => onReply('replyAll', email)} className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400">
            <ReplyAll className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={onNext}
          disabled={!hasNext}
          className="flex items-center gap-1 text-sm text-zinc-400 disabled:opacity-30"
        >
          {lang === 'ru' ? 'След.' : 'Next'}
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
};
