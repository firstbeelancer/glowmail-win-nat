import { useState } from 'react';
import { useMail } from '../../store';
import { Email } from '../../types';
import { formatDistanceToNow } from 'date-fns';
import { Star, Paperclip, Tag, Inbox, AlertTriangle, ArrowDownAZ, ArrowUpAZ, Calendar, User, Type, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

export function EmailList({ onSelect, onEditDraft }: { onSelect: (email: Email) => void, onEditDraft?: (email: Email) => void }) {
  const { emails, currentFolder, searchQuery, toggleStar, deleteEmail, settings } = useMail();
  const [sortBy, setSortBy] = useState<'date' | 'sender' | 'subject' | 'tags' | 'unread'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

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
  });

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

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Sort Toolbar */}
      <div className="px-4 py-2 border-b border-zinc-800/50 flex items-center justify-between bg-zinc-900/30 shrink-0">
        <span className="text-xs font-medium text-zinc-500">Sort by:</span>
        <div className="flex items-center gap-2">
          <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
            <button
              onClick={() => handleSort('unread')}
              className={cn("p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors", sortBy === 'unread' && "bg-zinc-800 text-zinc-100")}
              title="Unread First"
            >
              <Inbox className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleSort('date')}
              className={cn("p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors", sortBy === 'date' && "bg-zinc-800 text-zinc-100")}
              title="Date"
            >
              <Calendar className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleSort('sender')}
              className={cn("p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors", sortBy === 'sender' && "bg-zinc-800 text-zinc-100")}
              title="Sender"
            >
              <User className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleSort('subject')}
              className={cn("p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors", sortBy === 'subject' && "bg-zinc-800 text-zinc-100")}
              title="Subject"
            >
              <Type className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleSort('tags')}
              className={cn("p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors", sortBy === 'tags' && "bg-zinc-800 text-zinc-100")}
              title="Tags"
            >
              <Tag className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
            className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title={sortOrder === 'asc' ? "Ascending" : "Descending"}
          >
            {sortOrder === 'asc' ? <ArrowUpAZ className="w-3.5 h-3.5" /> : <ArrowDownAZ className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {sortedEmails.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 h-full">
          <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(255,255,255,0.02)]">
            <Inbox className="w-8 h-8 opacity-50" />
          </div>
          <p>No emails found</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {sortedEmails.map((email, index) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              key={email.id}
              onClick={() => onSelect(email)}
              onDoubleClick={() => {
                if (email.folderId === 'drafts' && onEditDraft) {
                  onEditDraft(email);
                }
              }}
              className={cn(
                "group flex flex-col p-4 border-b border-zinc-800/50 cursor-pointer transition-all hover:bg-zinc-900/50",
                !email.read && "bg-zinc-900/20"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {email.importance === 'high' && (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400 drop-shadow-[0_0_5px_rgba(248,113,113,0.5)]" title="High Importance" />
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
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteEmail(email.id);
                    }}
                    className="p-1 -mr-1 rounded-full hover:bg-zinc-800 text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete Email"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <div className="flex items-center gap-2 mb-1">
                <h3 className={cn("text-sm truncate flex-1", !email.read ? "font-bold text-zinc-100" : "font-medium text-zinc-400")}>
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
      )}
    </div>
  );
}
