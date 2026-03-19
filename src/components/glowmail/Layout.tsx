import React, { useState, ReactNode } from 'react';
import { Menu, Search, Edit3, Settings, Inbox, Send, File, AlertCircle, Trash2, Briefcase, Plus, RefreshCw, X, Clock, BookUser, ChevronDown, ChevronRight } from 'lucide-react';
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
  'alert-circle': AlertCircle,
  'trash-2': Trash2,
  briefcase: Briefcase,
};

export function Layout({ children, onCompose }: { children: ReactNode; onCompose: () => void }) {
  const { folders, currentFolder, setCurrentFolder, searchQuery, setSearchQuery, settings } = useMail();
  const lang = settings.language;
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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
              className="fixed inset-y-0 left-0 w-72 bg-zinc-900 border-r border-zinc-800/50 z-50 flex flex-col md:hidden"
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

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 lg:w-72 bg-zinc-900/50 border-r border-zinc-800/50 flex-col">
        <SidebarContent
          folders={folders}
          currentFolder={currentFolder}
          setCurrentFolder={setCurrentFolder}
          onCompose={onCompose}
          lang={lang}
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
          
          <div className="flex-1 max-w-2xl relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-emerald-400 transition-colors" />
            <input
              type="text"
              placeholder={t('layout.searchPlaceholder', lang)}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all placeholder:text-zinc-600"
            />
          </div>

          <button onClick={() => setIsSettingsOpen(true)} className="p-2 rounded-full hover:bg-zinc-800 transition-colors">
            <Settings className="w-5 h-5 text-zinc-400" />
          </button>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative">
          {children}
        </div>

        {/* Floating Action Button (Mobile) */}
        <button
          onClick={onCompose}
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
  onCompose?: () => void;
  lang: 'en' | 'ru';
}) {
  const { fetchEmails, addFolder, emails, contacts, addContact } = useMail();
  const [isFetching, setIsFetching] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');

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
            onClick={onCompose}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 text-zinc-950 rounded-xl font-bold text-sm shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:shadow-[0_0_25px_rgba(16,185,129,0.4)] hover:-translate-y-0.5 transition-all"
          >
            <Edit3 className="w-4 h-4" />
            {t('layout.compose', lang)}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
        <div className="flex items-center justify-between px-3 mt-2 mb-2">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('layout.folders', lang)}</span>
          <button onClick={() => setShowNewFolderModal(true)} className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        {folders.map((folder) => {
          const Icon = iconMap[folder.icon] || File;
          const isActive = currentFolder === folder.id;
          const count = getFolderCount(folder.id);
          return (
            <button
              key={folder.id}
              onClick={() => setCurrentFolder(folder.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-emerald-500/10 text-emerald-400 shadow-[inset_0_0_20px_rgba(16,185,129,0.05)]"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              )}
            >
              <Icon className={cn("w-4 h-4", isActive ? "text-emerald-400" : "text-zinc-500")} />
              <span className="flex-1 text-left">{translateFolderName(folder.id, folder.name, lang)}</span>
              {count > 0 && (
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-xs font-bold",
                  isActive ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-300"
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

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
