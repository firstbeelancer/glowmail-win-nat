import { useState } from 'react';
import { useMail } from '../../store';
import { motion } from 'framer-motion';
import { X, User, Server, Palette, PenTool, Tags, Plus, Trash2, Image as ImageIcon, Globe, FolderTree, Loader2, Layers, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { t } from '@/lib/i18n';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings, addFolder, addContact, allFoldersFlat } = useMail();
  const [activeTab, setActiveTab] = useState<'account' | 'server' | 'appearance' | 'signature' | 'tags'>('account');
  const [localSettings, setLocalSettings] = useState(settings);
  const [newTag, setNewTag] = useState('');
  const [newTagColor, setNewTagColor] = useState('#10b981');
  const [isFetchingFolders, setIsFetchingFolders] = useState(false);
  const [isLoadingLdap, setIsLoadingLdap] = useState(false);
  const lang = localSettings.language;

  const handleSave = () => {
    updateSettings(localSettings);
    toast.success(t('settings.saved', lang));
    onClose();
  };

  const handleAddTag = () => {
    if (newTag.trim() && !localSettings.availableTags.find(t => t.name === newTag.trim())) {
      setLocalSettings({
        ...localSettings,
        availableTags: [...localSettings.availableTags, { id: Date.now().toString(), name: newTag.trim(), color: newTagColor }],
      });
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagIdToRemove: string) => {
    setLocalSettings({
      ...localSettings,
      availableTags: localSettings.availableTags.filter(t => t.id !== tagIdToRemove),
    });
  };

  const handleUpdateTagColor = (tagId: string, color: string) => {
    setLocalSettings({
      ...localSettings,
      availableTags: localSettings.availableTags.map(t => t.id === tagId ? { ...t, color } : t),
    });
  };

  const tabs = [
    { id: 'account', label: t('settings.account', lang), icon: User },
    { id: 'server', label: t('settings.server', lang), icon: Server },
    { id: 'appearance', label: t('settings.appearance', lang), icon: Palette },
    { id: 'signature', label: t('settings.signature', lang), icon: PenTool },
    { id: 'tags', label: t('settings.tags', lang), icon: Tags },
  ] as const;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="w-full max-w-3xl bg-zinc-950 border border-zinc-800/50 rounded-2xl shadow-2xl flex flex-col md:flex-row overflow-hidden max-h-[85vh]"
      >
        {/* Sidebar */}
        <div className="w-full md:w-64 bg-zinc-900/50 border-r border-zinc-800/50 p-4 flex flex-row md:flex-col gap-2 overflow-x-auto shrink-0">
          <div className="hidden md:flex items-center justify-between mb-4 px-2">
            <h2 className="text-lg font-bold text-zinc-100">{t('settings.title', lang)}</h2>
          </div>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-400 shadow-[inset_0_0_20px_rgba(16,185,129,0.05)]"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                )}
              >
                <Icon className={cn("w-4 h-4", isActive ? "text-emerald-400" : "text-zinc-500")} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <div className="h-14 border-b border-zinc-800/50 flex items-center justify-between px-6 shrink-0">
            <h3 className="text-sm font-semibold text-zinc-100 capitalize">
              {activeTab === 'account' && t('settings.accountSettings', lang)}
              {activeTab === 'server' && t('settings.serverSettings', lang)}
              {activeTab === 'appearance' && t('settings.appearanceSettings', lang)}
              {activeTab === 'signature' && t('settings.signatureSettings', lang)}
              {activeTab === 'tags' && t('settings.tagsSettings', lang)}
            </h3>
            <button onClick={onClose} className="p-2 -mr-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'account' && (
              <div className="space-y-6 max-w-md">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-400">{t('settings.displayName', lang)}</label>
                  <input
                    type="text"
                    value={localSettings.account.name}
                    onChange={(e) => setLocalSettings({ ...localSettings, account: { ...localSettings.account, name: e.target.value } })}
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-400">{t('settings.emailAddress', lang)}</label>
                  <input
                    type="email"
                    value={localSettings.account.email}
                    onChange={(e) => setLocalSettings({ ...localSettings, account: { ...localSettings.account, email: e.target.value } })}
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-400">{t('settings.delayedSending', lang)}</label>
                  <input
                    type="number"
                    min="0"
                    value={localSettings.delayedSending}
                    onChange={(e) => setLocalSettings({ ...localSettings, delayedSending: parseInt(e.target.value) || 0 })}
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                  />
                  <p className="text-xs text-zinc-500">{t('settings.delayedDesc', lang)}</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-400">{t('settings.syncInterval', lang)}</label>
                  <select
                    value={localSettings.syncInterval}
                    onChange={(e) => setLocalSettings({ ...localSettings, syncInterval: parseInt(e.target.value) })}
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                  >
                    <option value={1}>1 {t('settings.minutes', lang)}</option>
                    <option value={5}>5 {t('settings.minutes', lang)}</option>
                    <option value={10}>10 {t('settings.minutes', lang)}</option>
                    <option value={15}>15 {t('settings.minutes', lang)}</option>
                    <option value={30}>30 {t('settings.minutes', lang)}</option>
                    <option value={60}>60 {t('settings.minutes', lang)}</option>
                    <option value={0}>{t('settings.syncManual', lang)}</option>
                  </select>
                  <p className="text-xs text-zinc-500">{t('settings.syncDesc', lang)}</p>
                </div>

                <div className="pt-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSettings.keepFiltersAcrossFolders}
                      onChange={(e) => setLocalSettings({ ...localSettings, keepFiltersAcrossFolders: e.target.checked })}
                      className="w-4 h-4 rounded border-zinc-700 text-emerald-500 focus:ring-emerald-500/50 bg-zinc-900"
                    />
                    <span className="text-sm text-zinc-300">{t('settings.keepFilters', lang)}</span>
                  </label>
                  <p className="text-xs text-zinc-500 ml-7 mt-1">{t('settings.keepFiltersDesc', lang)}</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-400">{t('settings.markAsReadDelay', lang)}</label>
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={localSettings.markAsReadDelay}
                    onChange={(e) => setLocalSettings({ ...localSettings, markAsReadDelay: parseInt(e.target.value) || 0 })}
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                  />
                  <p className="text-xs text-zinc-500">{t('settings.markAsReadDelayDesc', lang)}</p>
                </div>

                <div className="pt-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSettings.aiEnabled}
                      onChange={(e) => setLocalSettings({ ...localSettings, aiEnabled: e.target.checked })}
                      className="w-4 h-4 rounded border-zinc-700 text-emerald-500 focus:ring-emerald-500/50 bg-zinc-900"
                    />
                    <span className="text-sm text-zinc-300 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      {t('settings.aiEnabled', lang)}
                    </span>
                  </label>
                  <p className="text-xs text-zinc-500 ml-7 mt-1">{t('settings.aiEnabledDesc', lang)}</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    {t('settings.layoutMode', lang)}
                  </label>
                  <select
                    value={localSettings.layoutMode}
                    onChange={(e) => setLocalSettings({ ...localSettings, layoutMode: e.target.value as 'vertical' | 'horizontal' })}
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                  >
                    <option value="vertical">{t('settings.layoutVertical', lang)}</option>
                    <option value="horizontal">{t('settings.layoutHorizontal', lang)}</option>
                  </select>
                  <p className="text-xs text-zinc-500">{t('settings.layoutModeDesc', lang)}</p>
                </div>

                {/* Language Setting */}
                <div className="space-y-2 pt-4 border-t border-zinc-800/50">
                  <label className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    {t('settings.languageLabel', lang)}
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => setLocalSettings({ ...localSettings, language: 'en' })}
                      className={cn(
                        "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all",
                        localSettings.language === 'en'
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                          : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800"
                      )}
                    >
                      <span className="text-2xl">🇬🇧</span>
                      <span className="text-sm font-medium">{t('settings.english', lang)}</span>
                    </button>
                    <button
                      onClick={() => setLocalSettings({ ...localSettings, language: 'ru' })}
                      className={cn(
                        "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all",
                        localSettings.language === 'ru'
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                          : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800"
                      )}
                    >
                      <span className="text-2xl">🇷🇺</span>
                      <span className="text-sm font-medium">{t('settings.russian', lang)}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'server' && (
              <div className="space-y-8 max-w-md">
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-zinc-300 border-b border-zinc-800/50 pb-2">{t('settings.incomingImap', lang)}</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 space-y-2">
                      <label className="text-xs font-medium text-zinc-500">{t('settings.host', lang)}</label>
                      <input
                        type="text"
                        value={localSettings.server.imapHost}
                        onChange={(e) => setLocalSettings({ ...localSettings, server: { ...localSettings.server, imapHost: e.target.value } })}
                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-zinc-500">{t('settings.port', lang)}</label>
                      <input
                        type="number"
                        value={localSettings.server.imapPort}
                        onChange={(e) => setLocalSettings({ ...localSettings, server: { ...localSettings.server, imapPort: parseInt(e.target.value) || 993 } })}
                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-zinc-300 border-b border-zinc-800/50 pb-2">{t('settings.outgoingSmtp', lang)}</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 space-y-2">
                      <label className="text-xs font-medium text-zinc-500">{t('settings.host', lang)}</label>
                      <input
                        type="text"
                        value={localSettings.server.smtpHost}
                        onChange={(e) => setLocalSettings({ ...localSettings, server: { ...localSettings.server, smtpHost: e.target.value } })}
                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-zinc-500">{t('settings.port', lang)}</label>
                      <input
                        type="number"
                        value={localSettings.server.smtpPort}
                        onChange={(e) => setLocalSettings({ ...localSettings, server: { ...localSettings.server, smtpPort: parseInt(e.target.value) || 465 } })}
                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                      />
                    </div>
                  </div>
                </div>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={localSettings.server.secure}
                    onChange={(e) => setLocalSettings({ ...localSettings, server: { ...localSettings.server, secure: e.target.checked } })}
                    className="w-4 h-4 rounded border-zinc-700 text-emerald-500 focus:ring-emerald-500/50 bg-zinc-900"
                  />
                  <span className="text-sm text-zinc-300">{t('settings.secureConnection', lang)}</span>
                </label>

                {/* Authentication Method */}
                <div className="space-y-4 pt-4 border-t border-zinc-800/50">
                  <h4 className="text-sm font-semibold text-zinc-300 border-b border-zinc-800/50 pb-2">{t('settings.authMethod', lang)}</h4>
                  <select
                    value={localSettings.server.authMethod}
                    onChange={(e) => setLocalSettings({ ...localSettings, server: { ...localSettings.server, authMethod: e.target.value as any } })}
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                  >
                    <option value="password">{t('settings.authPassword', lang)}</option>
                    <option value="encrypted-password">{t('settings.authEncryptedPassword', lang)}</option>
                    <option value="oauth2">{t('settings.authOAuth2', lang)}</option>
                    <option value="app-password">{t('settings.authAppPassword', lang)}</option>
                    <option value="kerberos">{t('settings.authKerberos', lang)}</option>
                    <option value="ntlm">{t('settings.authNtlm', lang)}</option>
                    <option value="tls-certificate">{t('settings.authTlsCert', lang)}</option>
                  </select>
                  {localSettings.server.authMethod === 'oauth2' && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-zinc-500">{t('settings.oauthProvider', lang)}</label>
                      <select
                        value={localSettings.server.oauthProvider || ''}
                        onChange={(e) => setLocalSettings({ ...localSettings, server: { ...localSettings.server, oauthProvider: e.target.value } })}
                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                      >
                        <option value="">—</option>
                        <option value="google">Google</option>
                        <option value="microsoft">Microsoft / Outlook</option>
                        <option value="yahoo">Yahoo</option>
                      </select>
                    </div>
                  )}
                  {localSettings.server.authMethod === 'kerberos' && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-zinc-500">{t('settings.kerberosRealm', lang)}</label>
                      <input
                        type="text"
                        value={(localSettings.server as any).kerberosRealm || ''}
                        onChange={(e) => setLocalSettings({ ...localSettings, server: { ...localSettings.server, kerberosRealm: e.target.value } as any })}
                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                        placeholder="EXAMPLE.COM"
                      />
                    </div>
                  )}
                  {localSettings.server.authMethod === 'tls-certificate' && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-zinc-500">{t('settings.tlsCertPath', lang)}</label>
                        <input
                          type="text"
                          value={(localSettings.server as any).tlsCertPath || ''}
                          onChange={(e) => setLocalSettings({ ...localSettings, server: { ...localSettings.server, tlsCertPath: e.target.value } as any })}
                          className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                          placeholder="/path/to/cert.pem"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-zinc-500">{t('settings.tlsKeyPath', lang)}</label>
                        <input
                          type="text"
                          value={(localSettings.server as any).tlsKeyPath || ''}
                          onChange={(e) => setLocalSettings({ ...localSettings, server: { ...localSettings.server, tlsKeyPath: e.target.value } as any })}
                          className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                          placeholder="/path/to/key.pem"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Fetch Folders from Server */}
                <div className="pt-4 border-t border-zinc-800/50">
                  <button
                    onClick={async () => {
                      setIsFetchingFolders(true);
                      // Simulate loading folder tree from server
                      await new Promise(r => setTimeout(r, 1500));
                      const serverFolders = [
                        { name: 'INBOX/Notifications', icon: 'inbox' },
                        { name: 'INBOX/Subscriptions', icon: 'inbox' },
                        { name: 'Archive', icon: 'folder' },
                        { name: 'Junk', icon: 'alert-circle' },
                      ];
                      serverFolders.forEach(f => addFolder(f.name));
                      setIsFetchingFolders(false);
                      toast.success(lang === 'ru' ? 'Папки загружены с сервера' : 'Folders loaded from server');
                    }}
                    disabled={isFetchingFolders}
                    className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 rounded-xl font-medium text-sm border border-zinc-700/50 transition-all disabled:opacity-50"
                  >
                    {isFetchingFolders ? <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> : <FolderTree className="w-4 h-4" />}
                    {isFetchingFolders ? t('settings.fetchingFolders', lang) : t('settings.fetchFolders', lang)}
                  </button>
                </div>

                {/* LDAP */}
                <div className="space-y-4 pt-4 border-t border-zinc-800/50">
                  <h4 className="text-sm font-semibold text-zinc-300 border-b border-zinc-800/50 pb-2">{t('settings.ldapSection', lang)}</h4>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-zinc-500">{t('settings.ldapServer', lang)}</label>
                      <input
                        type="text"
                        value={localSettings.ldapServer}
                        onChange={(e) => setLocalSettings({ ...localSettings, ldapServer: e.target.value })}
                        placeholder="ldap://ldap.example.com:389"
                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-zinc-500">{t('settings.ldapBaseDn', lang)}</label>
                      <input
                        type="text"
                        value={localSettings.ldapBaseDn}
                        onChange={(e) => setLocalSettings({ ...localSettings, ldapBaseDn: e.target.value })}
                        placeholder="ou=people,dc=example,dc=com"
                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        setIsLoadingLdap(true);
                        await new Promise(r => setTimeout(r, 1500));
                        const ldapContacts = [
                          { id: `ldap-${Date.now()}-1`, name: 'John Doe', email: 'john.doe@corp.example.com' },
                          { id: `ldap-${Date.now()}-2`, name: 'Jane Smith', email: 'jane.smith@corp.example.com' },
                          { id: `ldap-${Date.now()}-3`, name: 'Admin Support', email: 'admin@corp.example.com' },
                        ];
                        ldapContacts.forEach(c => addContact(c));
                        setIsLoadingLdap(false);
                        toast.success(lang === 'ru' ? 'Контакты загружены из LDAP' : 'Contacts loaded from LDAP');
                      }}
                      disabled={isLoadingLdap || !localSettings.ldapServer}
                      className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 rounded-xl font-medium text-sm border border-zinc-700/50 transition-all disabled:opacity-50"
                    >
                      {isLoadingLdap ? <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> : <Globe className="w-4 h-4" />}
                      {isLoadingLdap ? t('settings.ldapLoading', lang) : t('settings.ldapLoad', lang)}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="space-y-6 max-w-md">
                <div className="space-y-4">
                  <label className="text-sm font-medium text-zinc-400">{t('settings.themePreference', lang)}</label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => setLocalSettings({ ...localSettings, theme: 'light' })}
                      className={cn(
                        "flex flex-col items-center gap-3 p-4 rounded-xl border transition-all",
                        localSettings.theme === 'light'
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                          : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800"
                      )}
                    >
                      <div className="w-12 h-12 rounded-full bg-zinc-200 flex items-center justify-center">
                        <div className="w-6 h-6 rounded-full bg-white shadow-sm" />
                      </div>
                      <span className="text-sm font-medium">{t('settings.light', lang)}</span>
                    </button>
                    <button
                      onClick={() => setLocalSettings({ ...localSettings, theme: 'dark' })}
                      className={cn(
                        "flex flex-col items-center gap-3 p-4 rounded-xl border transition-all",
                        localSettings.theme === 'dark'
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                          : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800"
                      )}
                    >
                      <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800">
                        <div className="w-6 h-6 rounded-full bg-zinc-800 shadow-sm" />
                      </div>
                      <span className="text-sm font-medium">{t('settings.dark', lang)}</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-zinc-800/50">
                  <label className="text-sm font-medium text-zinc-400">{t('settings.emailBgColor', lang)}</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={localSettings.emailBackground}
                      onChange={(e) => setLocalSettings({ ...localSettings, emailBackground: e.target.value })}
                      className="w-10 h-10 p-1 rounded-lg bg-zinc-900 border border-zinc-800 cursor-pointer"
                    />
                    <span className="text-sm text-zinc-300">{localSettings.emailBackground}</span>
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-zinc-800/50">
                  <label className="text-sm font-medium text-zinc-400">{t('settings.defaultFontColor', lang)}</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={localSettings.fontColor}
                      onChange={(e) => setLocalSettings({ ...localSettings, fontColor: e.target.value })}
                      className="w-10 h-10 p-1 rounded-lg bg-zinc-900 border border-zinc-800 cursor-pointer"
                    />
                    <span className="text-sm text-zinc-300">{localSettings.fontColor}</span>
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-zinc-800/50">
                  <label className="text-sm font-medium text-zinc-400">{t('settings.customFonts', lang)}</label>
                  <div className="space-y-2">
                    {localSettings.customFonts.map((font, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-2">
                        <span className="text-sm text-zinc-300">{font.name}</span>
                        <button
                          onClick={() => {
                            const newFonts = [...localSettings.customFonts];
                            newFonts.splice(idx, 1);
                            setLocalSettings({ ...localSettings, customFonts: newFonts });
                          }}
                          className="p-1 text-zinc-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const name = window.prompt('Enter font name (e.g., Roboto):');
                        const url = window.prompt('Enter font URL (e.g., Google Fonts CSS URL):');
                        if (name && url) {
                          setLocalSettings({
                            ...localSettings,
                            customFonts: [...localSettings.customFonts, { name, url }]
                          });
                        }
                      }}
                      className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors mt-2"
                    >
                      <Plus className="w-4 h-4" />
                      {t('settings.addCustomFont', lang)}
                    </button>
                  </div>
                </div>

                {/* Folder Colors */}
                <div className="space-y-4 pt-4 border-t border-zinc-800/50">
                  <label className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                    <FolderTree className="w-4 h-4" />
                    {t('settings.folderColors', lang)}
                  </label>
                  <p className="text-xs text-zinc-500">{t('settings.folderColorsDesc', lang)}</p>
                  {(() => {
                    const subfolders = allFoldersFlat.filter(f => f.parent);
                    if (subfolders.length === 0) {
                      return <p className="text-xs text-zinc-600">{t('settings.noSubfolders', lang)}</p>;
                    }
                    return (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {subfolders.map(f => (
                          <div key={f.id} className="flex items-center gap-3 bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-2">
                            <input
                              type="color"
                              value={localSettings.folderColors[f.id] || '#6b7280'}
                              onChange={(e) => setLocalSettings({
                                ...localSettings,
                                folderColors: { ...localSettings.folderColors, [f.id]: e.target.value }
                              })}
                              className="w-7 h-7 p-0.5 rounded-lg bg-zinc-900 border border-zinc-800 cursor-pointer shrink-0"
                            />
                            <span className="text-sm text-zinc-300 truncate flex-1">{f.name}</span>
                            {localSettings.folderColors[f.id] && (
                              <button
                                onClick={() => {
                                  const { [f.id]: _, ...rest } = localSettings.folderColors;
                                  setLocalSettings({ ...localSettings, folderColors: rest });
                                }}
                                className="p-1 text-zinc-500 hover:text-red-400 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Grouping */}
                <div className="space-y-4 pt-4 border-t border-zinc-800/50">
                  <label className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    {t('settings.groupBy', lang)}
                  </label>
                  <select
                    value={localSettings.groupBy}
                    onChange={(e) => setLocalSettings({ ...localSettings, groupBy: e.target.value as any })}
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                  >
                    <option value="none">{t('settings.groupNone', lang)}</option>
                    <option value="date">{t('settings.groupDate', lang)}</option>
                    <option value="sender">{t('settings.groupSender', lang)}</option>
                    <option value="tag">{t('settings.groupTag', lang)}</option>
                  </select>
                  <p className="text-xs text-zinc-500">{t('settings.groupDesc', lang)}</p>
                </div>
              </div>
            )}

            {activeTab === 'signature' && (
              <div className="space-y-6 max-w-2xl">
                <div className="flex items-center justify-between border-b border-zinc-800/50 pb-4">
                  <h3 className="text-sm font-medium text-zinc-300">{t('settings.manageSignatures', lang)}</h3>
                  <button
                    onClick={() => {
                      const name = window.prompt(lang === 'ru' ? 'Введите название подписи:' : 'Enter signature name:');
                      if (name) {
                        const newSig = { id: Date.now().toString(), name, content: '<p><br>--<br>Sent from GlowMail AI</p>' };
                        setLocalSettings({
                          ...localSettings,
                          signatures: [...localSettings.signatures, newSig],
                          defaultSignatureId: localSettings.signatures.length === 0 ? newSig.id : localSettings.defaultSignatureId
                        });
                      }
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('settings.newSignature', lang)}
                  </button>
                </div>

                <div className="space-y-6">
                  {localSettings.signatures.map((sig) => (
                    <div key={sig.id} className="space-y-3 p-4 bg-zinc-900/30 border border-zinc-800/50 rounded-xl">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <input
                            type="text"
                            value={sig.name}
                            onChange={(e) => {
                              const newSigs = localSettings.signatures.map(s => s.id === sig.id ? { ...s, name: e.target.value } : s);
                              setLocalSettings({ ...localSettings, signatures: newSigs });
                            }}
                            className="bg-transparent border-none outline-none text-sm font-medium text-zinc-200 focus:ring-0 p-0"
                          />
                          {localSettings.defaultSignatureId === sig.id ? (
                            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] uppercase tracking-wider font-bold rounded-full">{t('settings.default', lang)}</span>
                          ) : (
                            <button
                              onClick={() => setLocalSettings({ ...localSettings, defaultSignatureId: sig.id })}
                              className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
                            >
                              {t('settings.setAsDefault', lang)}
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              const url = window.prompt(lang === 'ru' ? 'Введите URL изображения:' : 'Enter image URL:');
                              if (url) {
                                const newSigs = localSettings.signatures.map(s => 
                                  s.id === sig.id ? { ...s, content: s.content + `<br><img src="${url}" alt="Logo" style="max-height: 50px;" />` } : s
                                );
                                setLocalSettings({ ...localSettings, signatures: newSigs });
                              }
                            }}
                            className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
                            title={t('settings.insertLogo', lang)}
                          >
                            <ImageIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              const newSigs = localSettings.signatures.filter(s => s.id !== sig.id);
                              setLocalSettings({ 
                                ...localSettings, 
                                signatures: newSigs,
                                defaultSignatureId: localSettings.defaultSignatureId === sig.id ? newSigs[0]?.id : localSettings.defaultSignatureId
                              });
                            }}
                            className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-red-400 transition-colors"
                            title={t('settings.deleteSignature', lang)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={sig.content}
                        onChange={(e) => {
                          const newSigs = localSettings.signatures.map(s => s.id === sig.id ? { ...s, content: e.target.value } : s);
                          setLocalSettings({ ...localSettings, signatures: newSigs });
                        }}
                        className="w-full h-32 bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 font-mono"
                        placeholder={t('settings.signaturePlaceholder', lang)}
                      />
                    </div>
                  ))}
                  {localSettings.signatures.length === 0 && (
                    <div className="text-center py-8 text-zinc-500 text-sm">
                      {t('settings.noSignatures', lang)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'tags' && (
              <div className="space-y-6 max-w-md">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-400">{t('settings.addNewTag', lang)}</label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={newTagColor}
                      onChange={(e) => setNewTagColor(e.target.value)}
                      className="w-10 h-10 rounded-xl bg-zinc-900/50 border border-zinc-800 cursor-pointer p-1"
                    />
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                      placeholder={t('settings.tagPlaceholder', lang)}
                      className="flex-1 bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                    />
                    <button
                      onClick={handleAddTag}
                      disabled={!newTag.trim()}
                      className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-100 rounded-xl font-medium text-sm transition-colors flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" /> {t('settings.add', lang)}
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-zinc-400">{t('settings.availableTags', lang)}</label>
                  <div className="flex flex-col gap-2">
                    {localSettings.availableTags.map((tag) => (
                      <div
                        key={tag.id}
                        className="flex items-center justify-between px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg group"
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={tag.color}
                            onChange={(e) => handleUpdateTagColor(tag.id, e.target.value)}
                            className="w-6 h-6 rounded bg-transparent border-none cursor-pointer p-0"
                          />
                          <span className="text-sm text-zinc-300 font-medium">{tag.name}</span>
                        </div>
                        <button
                          onClick={() => handleRemoveTag(tag.id)}
                          className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {localSettings.availableTags.length === 0 && (
                      <p className="text-sm text-zinc-500 italic">{t('settings.noTags', lang)}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="h-16 border-t border-zinc-800/50 flex items-center justify-end px-6 gap-3 shrink-0 bg-zinc-900/30">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              {t('settings.cancel', lang)}
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-emerald-500 text-zinc-950 rounded-xl font-semibold text-sm shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_25px_rgba(16,185,129,0.5)] transition-all"
            >
              {t('settings.saveChanges', lang)}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
