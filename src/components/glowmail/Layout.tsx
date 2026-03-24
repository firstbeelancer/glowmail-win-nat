import React, { useState, ReactNode, DragEvent, useCallback, useRef, useEffect } from 'react';
import { Menu, Search, Edit3, Settings, Inbox, Send, File, AlertCircle, Trash2, Briefcase, Plus, RefreshCw, X, Clock, BookUser, ChevronDown, ChevronRight, Mail, LogOut, FolderIcon, FileText } from 'lucide-react';
import { useMail } from '../../store';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { SettingsModal } from './SettingsModal';
import { t, translateFolderName } from '@/lib/i18n';

const iconMap: Record<string, any> = {
  inbox: Inbox,
  send: Send,
  clock: Clock,
  file: File,
  'file-text': FileText,
  'alert-circle': AlertCircle,
  'trash-2': Trash2,
  briefcase: Briefcase,
  folder: FolderIcon,
};

export function Layout({ children, onCompose }: { children: ReactNode; onCompose: (prefill?: { to?: string }) => void }) {
  const { folders, currentFolder, setCurrentFolder, searchQuery, setSearchQuery, settings, fetchEmails } = useMail();
  const lang = settings.language;
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('glowmail_sidebar_width');
    return saved ? Number(saved) : 256;
  });
  const isResizing = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(Math.max(ev.clientX, 180), 400);
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setSidebarWidth(w => { localStorage.setItem('glowmail_sidebar_width', String(w)); return w; });
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
              onClick={() => setIsSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
              className="fixed inset-y-0 left-0 w-72 bg-gradient-to-b from-emerald-950/40 via-zinc-900/70 to-zinc-900/50 border-r border-emerald-800/30 z-50 flex flex-col md:hidden"
            >
              <SidebarContent
                folders={folders}
                currentFolder={currentFolder}
                setCurrentFolder={(id) => {
                  setCurrentFolder(id);
                  setIsSidebarOpen(false);
                }}
                onCompose={() => {
                  onCompose();
                  setIsSidebarOpen(false);
                }}
                lang={lang}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar - resizable */}
      <aside className="hidden md:flex bg-gradient-to-b from-emerald-950/40 via-zinc-900/70 to-zinc-900/50 border-r border-emerald-800/30 flex-col relative font-medium" style={{ width: sidebarWidth, minWidth: 180, maxWidth: 400 }}>
        <SidebarContent
          folders={folders}
          currentFolder={currentFolder}
          setCurrentFolder={setCurrentFolder}
          onCompose={onCompose}
          lang={lang}
        />
        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize group z-20 hover:bg-emerald-500/30 active:bg-emerald-500/40 transition-colors"
        />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="h-16 border-b border-zinc-800/50 flex items-center px-4 gap-4 bg-zinc-950/80 backdrop-blur-md z-10 sticky top-0">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 -ml-2 rounded-full hover:bg-zinc-800 md:hidden transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            onClick={() => fetchEmails()}
            className="p-2 rounded-full hover:bg-zinc-800 md:hidden transition-colors"
            title={lang === 'ru' ? 'Получить письма' : 'Get mail'}
          >
            <RefreshCw className="w-5 h-5 text-zinc-400" />
          </button>
          
          <div className="flex-1 max-w-2xl relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-emerald-400 transition-colors" />
            <input
              type="text"
              placeholder={t('layout.searchPlaceholder', lang)}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-full pl-10 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all placeholder:text-zinc-600"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200 transition-colors"
                title={lang === 'ru' ? 'Сбросить поиск' : 'Clear search'}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button onClick={() => setIsSettingsOpen(true)} className="p-2 rounded-full hover:bg-zinc-800 transition-colors" title={lang === 'ru' ? 'Настройки' : 'Settings'}>
            <Settings className="w-5 h-5 text-zinc-400" />
          </button>
          <button
            onClick={() => {
              import('@/lib/credentials').then(({ clearCredentials }) => {
                clearCredentials();
                window.location.reload();
              });
            }}
            className="p-2 rounded-full hover:bg-zinc-800 transition-colors"
            title={lang === 'ru' ? 'Выйти' : 'Log out'}
          >
            <LogOut className="w-5 h-5 text-zinc-400" />
          </button>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative">
          {children}
        </div>

        {/* Floating Action Button (Mobile) */}
        <button
          onClick={() => onCompose()}
          className="md:hidden absolute bottom-6 right-6 w-14 h-14 bg-emerald-500 rounded-full flex items-center justify-center text-zinc-950 shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:shadow-[0_0_30px_rgba(16,185,129,0.6)] hover:scale-105 transition-all active:scale-95 z-30"
        >
          <Edit3 className="w-6 h-6" />
        </button>

        {/* Settings Modal */}
        <AnimatePresence>
          {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
        </AnimatePresence>
      </main>
    </div>
  );
}

function SidebarContent({
  folders,
  currentFolder,
  setCurrentFolder,
  onCompose,
  lang,
}: {
  folders: any[];
  currentFolder: string;
  setCurrentFolder: (id: string) => void;
  onCompose?: (prefill?: { to?: string }) => void;
  lang: 'en' | 'ru';
}) {
  const { fetchEmails, addFolder, emails, contacts, addContact, moveEmailToFolder, settings: mailSettings, totalEmails } = useMail();
  const folderColors = mailSettings.folderColors || {};
  const [isFetching, setIsFetching] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ INBOX: true });
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  const handleFolderDragOver = (e: DragEvent, folderId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverFolder(folderId);
  };

  const handleFolderDragLeave = () => {
    setDragOverFolder(null);
  };

  const handleFolderDrop = (e: DragEvent, folderId: string) => {
    e.preventDefault();
    setDragOverFolder(null);
    const emailId = e.dataTransfer.getData('text/email-id');
    if (emailId && folderId !== currentFolder) {
      moveEmailToFolder(emailId, folderId);
    }
  };

  const getFolderCount = (folderId: string) => {
    const folderEmails = emails.filter(e => e.folderId === folderId);
    if (folderId === 'inbox' || folderId === 'spam') {
      return folderEmails.filter(e => !e.read).length;
    }
    return folderEmails.length;
  };

  const handleFetch = async () => {
    setIsFetching(true);
    await fetchEmails();
    setIsFetching(false);
  };

  const handleAddFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (newFolderName.trim()) {
      addFolder(newFolderName.trim());
      setNewFolderName('');
      setShowNewFolderModal(false);
    }
  };

  return (
    <>
      <div className="p-4 h-16 flex items-center border-b border-zinc-800/50 shrink-0">
        <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent tracking-tight">
          {t('app.title', lang)}
        </h1>
      </div>
      
      {onCompose && (
        <div className="px-4 py-4 shrink-0 hidden md:flex flex-col gap-2">
          <button
            onClick={handleFetch}
            disabled={isFetching}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 rounded-xl font-medium text-sm border border-zinc-700/50 transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin text-emerald-400")} />
            {t('layout.getMail', lang)}
          </button>
          <button
            onClick={() => onCompose?.()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 text-zinc-950 rounded-xl font-bold text-sm shadow-[0_0_20px_rgba(16,185,129,0.35),0_0_40px_rgba(16,185,129,0.15)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5),0_0_60px_rgba(16,185,129,0.25)] hover:-translate-y-0.5 transition-all"
          >
            <Edit3 className="w-4 h-4" />
            {t('layout.compose', lang)}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
        {/* Total email counter */}
        <div className="px-3 py-2 mb-1 flex items-center gap-2">
          <Mail className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs font-extrabold text-emerald-300 tracking-wide">
            {emails.length} {lang === 'ru' ? 'писем' : 'emails'}
          </span>
        </div>
        <div className="flex items-center justify-between px-3 mt-1 mb-2">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('layout.folders', lang)}</span>
          <button onClick={() => setShowNewFolderModal(true)} className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        {folders.map((folder) => {
          const Icon = iconMap[folder.icon] || FolderIcon;
          const isActive = currentFolder === folder.id;
          const count = getFolderCount(folder.id);
          const hasChildren = folder.children && folder.children.length > 0;
          const isExpanded = expandedFolders[folder.id] ?? false;
          return (
             <div key={folder.id}>
              <div
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                    isActive
                    ? "bg-emerald-500/15 text-emerald-300 font-bold shadow-[inset_0_0_20px_rgba(16,185,129,0.08)]"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200",
                  dragOverFolder === folder.id && "ring-2 ring-emerald-400/50 bg-emerald-500/10"
                )}
              >
                {hasChildren && (
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedFolders(prev => ({ ...prev, [folder.id]: !isExpanded }));
                    }}
                    className="p-0.5 -ml-1 hover:bg-zinc-700/50 rounded transition-colors cursor-pointer"
                  >
                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </span>
                )}
                <button
                  onClick={() => setCurrentFolder(folder.id)}
                  onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                  onDragLeave={handleFolderDragLeave}
                  onDrop={(e) => handleFolderDrop(e, folder.id)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                <Icon className={cn("w-4 h-4", isActive ? "text-emerald-400" : "text-zinc-500")} />
                <span className="flex-1 text-left">{translateFolderName(folder.id, folder.name, lang)}</span>
                 {count > 0 && (
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-xs font-extrabold",
                    isActive ? "bg-emerald-500/25 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.3)]" : "bg-zinc-800 text-zinc-300"
                  )}>
                    {count}
                  </span>
                 )}
                </button>
              </div>
              {hasChildren && isExpanded && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-zinc-800/50 pl-2">
                  {folder.children!.map((child) => {
                    const ChildIcon = iconMap[child.icon] || FolderIcon;
                    const isChildActive = currentFolder === child.id;
                    const childCount = getFolderCount(child.id);
                    const childColor = folderColors[child.id];
                    return (
                      <button
                        key={child.id}
                        onClick={() => setCurrentFolder(child.id)}
                        onDragOver={(e) => handleFolderDragOver(e, child.id)}
                        onDragLeave={handleFolderDragLeave}
                        onDrop={(e) => handleFolderDrop(e, child.id)}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-200",
                          isChildActive
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300",
                          dragOverFolder === child.id && "ring-2 ring-emerald-400/50 bg-emerald-500/10"
                        )}
                      >
                        <ChildIcon className="w-3.5 h-3.5" style={childColor ? { color: childColor } : undefined} />
                        <span className="flex-1 text-left truncate" style={childColor && !isChildActive ? { color: childColor } : undefined}>{translateFolderName(child.id, child.name, lang)}</span>
                        {childCount > 0 && (
                          <span className={cn(
                            "px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                            isChildActive ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-400"
                          )}>
                            {childCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Address Book */}
      <div className="px-3 py-2 border-t border-zinc-800/50">
        <button
          onClick={() => setShowAddressBook(!showAddressBook)}
          className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider hover:text-zinc-300 transition-colors"
        >
          <BookUser className="w-3.5 h-3.5" />
          <span className="flex-1 text-left">{t('layout.addressBook', lang)}</span>
          {showAddressBook ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        {showAddressBook && (
          <div className="mt-1 space-y-1 max-h-40 overflow-y-auto glow-scrollbar">
            {contacts.length === 0 && (
              <p className="px-3 py-2 text-xs text-zinc-600">{t('layout.noContacts', lang)}</p>
            )}
            {contacts.map(c => (
              <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-zinc-800/50 transition-colors group/contact">
                <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400 shrink-0">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-zinc-300 truncate">{c.name}</div>
                  <div className="text-[10px] text-zinc-500 truncate">{c.email}</div>
                </div>
                <button
                  onClick={() => onCompose?.({ to: c.email })}
                  className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-emerald-400 transition-colors opacity-0 group-hover/contact:opacity-100"
                  title={lang === 'ru' ? 'Написать письмо' : 'Compose email'}
                >
                  <Mail className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setShowAddContact(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-500 hover:text-emerald-400 transition-colors w-full"
            >
              <Plus className="w-3 h-3" /> {t('layout.addContact', lang)}
            </button>
          </div>
        )}
      </div>

      {/* Add Contact Modal */}
      <AnimatePresence>
        {showAddContact && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-4 border-b border-zinc-800/50 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-zinc-100">{t('layout.addContact', lang)}</h2>
                <button onClick={() => setShowAddContact(false)} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-zinc-200 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                if (newContactName.trim() && newContactEmail.trim()) {
                  addContact({ id: `c${Date.now()}`, name: newContactName.trim(), email: newContactEmail.trim() });
                  setNewContactName('');
                  setNewContactEmail('');
                  setShowAddContact(false);
                }
              }} className="p-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">{t('layout.contactName', lang)}</label>
                  <input type="text" value={newContactName} onChange={e => setNewContactName(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all glow-input"
                    autoFocus />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">{t('layout.contactEmail', lang)}</label>
                  <input type="email" value={newContactEmail} onChange={e => setNewContactEmail(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all glow-input" />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowAddContact(false)} className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors">
                    {t('layout.cancel', lang)}
                  </button>
                  <button type="submit" disabled={!newContactName.trim() || !newContactEmail.trim()}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {t('layout.create', lang)}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showNewFolderModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-4 border-b border-zinc-800/50 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-zinc-100">{t('layout.createFolder', lang)}</h2>
                <button
                  onClick={() => setShowNewFolderModal(false)}
                  className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleAddFolder} className="p-4">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">{t('layout.folderName', lang)}</label>
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                    placeholder={t('layout.folderPlaceholder', lang)}
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowNewFolderModal(false)}
                    className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors"
                  >
                    {t('layout.cancel', lang)}
                  </button>
                  <button
                    type="submit"
                    disabled={!newFolderName.trim()}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('layout.create', lang)}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
