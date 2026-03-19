import { useState, useRef, useEffect } from 'react';
import { useMail } from '../../store';
import { ChevronDown as ChevronDownIcon } from 'lucide-react';
import { Email } from '../../types';
import { formatDistanceToNow } from 'date-fns';
import { Star, Paperclip, Tag, Inbox, AlertTriangle, ArrowDownAZ, ArrowUpAZ, Calendar, User, Type, Trash2, MoreVertical, Download, Printer, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { t } from '@/lib/i18n';

export function EmailList({ onSelect, onEditDraft, selectedEmailId }: { onSelect: (email: Email) => void, onEditDraft?: (email: Email) => void, selectedEmailId?: string }) {
  const { emails, currentFolder, searchQuery, toggleStar, deleteEmail, settings, updateEmailTags, isLoading, isLoadingMore, hasMoreEmails, totalEmails, connectionError, fetchEmails, loadMoreEmails } = useMail();
  const lang = settings.language;
  const [sortBy, setSortBy] = useState<'date' | 'sender' | 'subject' | 'tags' | 'unread'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [starredOnly, setStarredOnly] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [tagPickerOpenId, setTagPickerOpenId] = useState<string | null>(null);
  const prevFolderRef = useRef(currentFolder);

  // Reset sort when folder changes, unless keepFiltersAcrossFolders is on
  useEffect(() => {
    if (prevFolderRef.current !== currentFolder) {
      prevFolderRef.current = currentFolder;
      if (!settings.keepFiltersAcrossFolders) {
        setSortBy('date');
        setSortOrder('desc');
      }
    }
  }, [currentFolder, settings.keepFiltersAcrossFolders]);

  const handleSort = (type: 'date' | 'sender' | 'subject' | 'tags' | 'unread') => {
    if (sortBy === type) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(type);
      setSortOrder(type === 'date' ? 'desc' : 'asc');
    }
  };

  const getTagColor = (tagName: string) => {
    const tagDef = settings.availableTags.find(t => t.name === tagName);
    return tagDef ? tagDef.color : '#10b981';
  };

  const toggleEmailTag = (emailId: string, tagName: string) => {
    const email = emails.find(e => e.id === emailId);
    if (!email) return;
    const newTags = email.tags.includes(tagName)
      ? email.tags.filter(t => t !== tagName)
      : [...email.tags, tagName];
    updateEmailTags(emailId, newTags);
  };

  const handleSaveEmail = (email: Email, e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpenId(null);
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
    const emlContent = lines.join('\r\n');
    const blob = new Blob([emlContent], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${email.subject || 'email'}.eml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintEmail = (email: Email, e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpenId(null);
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

  const filteredEmails = emails.filter((email) => {
    const matchesFolder = email.folderId === currentFolder;
    const matchesSearch =
      searchQuery === '' ||
      email.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.from.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.from.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.to.some((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      email.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase())) ||
      email.attachments.some((att) => att.name.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesFolder && matchesSearch;
  }).filter(email => !starredOnly || email.starred);

  const sortedEmails = [...filteredEmails].sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'date') {
      comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
    } else if (sortBy === 'sender') {
      comparison = a.from.name.localeCompare(b.from.name);
    } else if (sortBy === 'subject') {
      comparison = a.subject.localeCompare(b.subject);
    } else if (sortBy === 'tags') {
      const aTags = a.tags.join(',');
      const bTags = b.tags.join(',');
      comparison = aTags.localeCompare(bTags);
    } else if (sortBy === 'unread') {
      comparison = (a.read === b.read) ? 0 : a.read ? -1 : 1;
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  // Group emails
  const groupBy = settings.groupBy || 'none';
  const groupedEmails: { label: string; emails: Email[] }[] = [];
  if (groupBy === 'none') {
    groupedEmails.push({ label: '', emails: sortedEmails });
  } else {
    const groups: Record<string, Email[]> = {};
    sortedEmails.forEach(email => {
      let key = '';
      if (groupBy === 'date') {
        const d = new Date(email.date);
        key = d.toLocaleDateString();
      } else if (groupBy === 'sender') {
        key = email.from.name || email.from.email;
      } else if (groupBy === 'tag') {
        key = email.tags.length > 0 ? email.tags[0] : (lang === 'ru' ? 'Без тега' : 'No tag');
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(email);
    });
    Object.entries(groups).forEach(([label, emails]) => groupedEmails.push({ label, emails }));
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Sort Toolbar */}
      <div className="px-4 py-2 border-b border-zinc-800/50 flex items-center justify-between bg-zinc-900/30 shrink-0">
        <span className="text-xs font-medium text-zinc-500">{t('emailList.sortBy', lang)}</span>
        <div className="flex items-center gap-2">
          <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
            <button
              onClick={() => handleSort('unread')}
              className={cn("p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors", sortBy === 'unread' && "bg-zinc-800 text-zinc-100")}
              title={t('emailList.unreadFirst', lang)}
            >
              <Inbox className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleSort('date')}
              className={cn("p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors", sortBy === 'date' && "bg-zinc-800 text-zinc-100")}
              title={t('emailList.date', lang)}
            >
              <Calendar className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleSort('sender')}
              className={cn("p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors", sortBy === 'sender' && "bg-zinc-800 text-zinc-100")}
              title={t('emailList.sender', lang)}
            >
              <User className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleSort('subject')}
              className={cn("p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors", sortBy === 'subject' && "bg-zinc-800 text-zinc-100")}
              title={t('emailList.subject', lang)}
            >
              <Type className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleSort('tags')}
              className={cn("p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors", sortBy === 'tags' && "bg-zinc-800 text-zinc-100")}
              title={t('emailList.tags', lang)}
            >
            <Tag className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            onClick={() => setStarredOnly(prev => !prev)}
            className={cn("p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors", starredOnly && "bg-yellow-500/10 text-yellow-500 border-yellow-500/30")}
            title={t('emailList.starredOnly', lang)}
          >
            <Star className={cn("w-3.5 h-3.5", starredOnly && "fill-yellow-500")} />
          </button>
          <button
            onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
            className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title={sortOrder === 'asc' ? t('emailList.ascending', lang) : t('emailList.descending', lang)}
          >
            {sortOrder === 'asc' ? <ArrowUpAZ className="w-3.5 h-3.5" /> : <ArrowDownAZ className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isLoading && emails.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 h-full">
          <svg className="w-8 h-8 animate-spin text-primary mb-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <p>{lang === 'ru' ? 'Загрузка писем...' : 'Loading emails...'}</p>
        </div>
      ) : connectionError ? (
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 h-full px-6">
          <AlertTriangle className="w-8 h-8 text-yellow-500 mb-3" />
          <p className="text-sm text-center mb-3">{connectionError}</p>
          <button onClick={() => fetchEmails()} className="text-xs text-primary hover:underline">
            {lang === 'ru' ? 'Попробовать снова' : 'Try again'}
          </button>
        </div>
      ) : sortedEmails.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 h-full">
          <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(255,255,255,0.02)]">
            <Inbox className="w-8 h-8 opacity-50" />
          </div>
          <p>{t('emailList.noEmails', lang)}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {groupedEmails.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <div className="px-4 py-2 bg-zinc-900/50 border-b border-zinc-800/50 sticky top-0 z-10">
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{group.label}</span>
                </div>
              )}
              {group.emails.map((email, index) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              key={email.id}
              draggable
              onDragStart={(e: any) => {
                e.dataTransfer.setData('text/email-id', email.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => onSelect(email)}
              onDoubleClick={() => {
                if (email.folderId === 'drafts' && onEditDraft) {
                  onEditDraft(email);
                }
              }}
              className={cn(
                "group flex flex-col p-4 border-b border-zinc-800/50 cursor-grab transition-all hover:bg-zinc-900/50 relative active:cursor-grabbing",
                !email.read && "bg-zinc-900/20",
                email.starred && "bg-emerald-500/[0.03] shadow-[inset_0_0_25px_rgba(16,185,129,0.06)]",
                selectedEmailId === email.id && "ring-1 ring-emerald-500/50 bg-emerald-500/[0.06] border-l-2 border-l-emerald-500"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {email.importance === 'high' && (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400 drop-shadow-[0_0_5px_rgba(248,113,113,0.5)]" />
                  )}
                  <span className={cn("font-semibold text-sm", !email.read ? "text-zinc-100" : "text-zinc-300")}>
                    {email.from.name}
                  </span>
                  {email.attachments.length > 0 && (
                    <Paperclip className="w-3 h-3 text-zinc-500" />
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500">
                    {formatDistanceToNow(new Date(email.date), { addSuffix: true })}
                  </span>
                  {/* Tag picker button */}
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTagPickerOpenId(tagPickerOpenId === email.id ? null : email.id);
                        setMenuOpenId(null);
                      }}
                      className="p-1 -mr-1 rounded-full hover:bg-zinc-800 text-zinc-600 hover:text-emerald-400 transition-colors opacity-0 group-hover:opacity-100"
                      title={t('emailList.addTag', lang)}
                    >
                      <Tag className="w-3.5 h-3.5" />
                    </button>
                    {tagPickerOpenId === email.id && (
                      <div
                        className="absolute right-0 top-full mt-1 w-44 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="p-1.5 flex flex-col max-h-48 overflow-y-auto">
                          <span className="px-2 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{t('emailList.assignTags', lang)}</span>
                          {settings.availableTags.map(tag => {
                            const isActive = email.tags.includes(tag.name);
                            return (
                              <button
                                key={tag.id}
                                onClick={() => toggleEmailTag(email.id, tag.name)}
                                className={cn(
                                  "flex items-center gap-2 text-left px-3 py-1.5 text-xs rounded-lg transition-colors",
                                  isActive ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                                )}
                              >
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                                {tag.name}
                                {isActive && <span className="ml-auto text-emerald-400 text-[10px]">✓</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStar(email.id);
                    }}
                    className="p-1 -mr-1 rounded-full hover:bg-zinc-800 transition-colors"
                  >
                    <Star
                      className={cn(
                        "w-4 h-4 transition-all",
                        email.starred ? "fill-yellow-500 text-yellow-500 drop-shadow-[0_0_8px_rgba(234,179,8,0.5)]" : "text-zinc-600"
                      )}
                    />
                  </button>
                  {/* Three-dot menu */}
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === email.id ? null : email.id);
                        setTagPickerOpenId(null);
                      }}
                      className="p-1 -mr-1 rounded-full hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {menuOpenId === email.id && (
                      <div className="absolute right-0 top-full mt-1 w-40 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50">
                        <div className="p-1 flex flex-col">
                          <button
                            onClick={(e) => handleSaveEmail(email, e)}
                            className="flex items-center gap-2 text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            {t('emailList.save', lang)}
                          </button>
                          <button
                            onClick={(e) => handlePrintEmail(email, e)}
                            className="flex items-center gap-2 text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors"
                          >
                            <Printer className="w-4 h-4" />
                            {t('emailList.print', lang)}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenId(null);
                              deleteEmail(email.id);
                            }}
                            className="flex items-center gap-2 text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-red-400 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            {t('emailList.deleteEmail', lang)}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2 mb-1">
                <h3 className={cn(
                  "text-sm flex-1",
                  !email.read ? "font-bold text-zinc-100" : "font-medium text-zinc-400",
                  email.starred && "font-bold text-emerald-300"
                )}>
                  {email.subject}
                </h3>
              </div>
              
              <p className="text-sm text-zinc-500 truncate mb-2">
                {email.snippet}
              </p>

              {email.tags.length > 0 && (
                <div className="flex items-center gap-2 mt-1">
                  {email.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-zinc-800/80 text-zinc-400 border border-zinc-700/50"
                    >
                      <Tag className="w-2.5 h-2.5" style={{ color: getTagColor(tag) }} />
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
            </div>
          ))}
          {hasMoreEmails && (
            <div className="p-4 flex flex-col items-center gap-1">
              <button
                onClick={() => loadMoreEmails()}
                disabled={isLoadingMore}
                className="w-full py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm font-medium hover:bg-zinc-800 hover:text-zinc-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoadingMore ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    {lang === 'ru' ? 'Загрузка...' : 'Loading...'}
                  </>
                ) : (
                  <>
                    <ChevronDownIcon className="w-4 h-4" />
                    {lang === 'ru' ? `Загрузить ещё (${emails.filter(e => e.folderId === currentFolder).length} из ${totalEmails})` : `Load more (${emails.filter(e => e.folderId === currentFolder).length} of ${totalEmails})`}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
