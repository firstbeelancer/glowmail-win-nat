import React, { useState, useEffect } from 'react';
import { Email } from '../../types';
import { useMail } from '../../store';
import { format } from 'date-fns';
import { ArrowLeft, Reply, ReplyAll, Forward, MoreVertical, Star, Paperclip, Download, Trash2, Tag, File, Image as ImageIcon, FileText, AlertTriangle, Sparkles, Loader2, Edit3, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export const EmailDetail: React.FC<{ email: Email; onBack: () => void; onReply: (type: 'reply' | 'replyAll' | 'forward', email: Email, quickReplyText?: string) => void; onEditDraft?: (email: Email) => void }> = ({ email, onBack, onReply, onEditDraft }) => {
  const { toggleStar, deleteEmail, settings } = useMail();
  const [showHeaders, setShowHeaders] = useState(false);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [isGeneratingReplies, setIsGeneratingReplies] = useState(false);

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
    if (email.folderId !== 'drafts' && email.folderId !== 'sent') {
      generateReplies();
    }
    return () => { cancelled = true; };
  }, [email.id]);

  const getTagColor = (tagName: string) => {
    const tagDef = settings.availableTags.find(t => t.name === tagName);
    return tagDef ? tagDef.color : '#10b981';
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSave = () => {
    const content = `From: ${email.from.name} <${email.from.email}>\nTo: ${email.to.map(t => `${t.name} <${t.email}>`).join(', ')}\nDate: ${new Date(email.date).toString()}\nSubject: ${email.subject}\n\n${email.body.replace(/<[^>]*>?/gm, '')}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${email.subject || 'email'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
      className="absolute inset-0 bg-zinc-950 z-20 flex flex-col h-full overflow-hidden"
    >
      {/* Top Bar */}
      <header className="h-16 border-b border-zinc-800/50 flex items-center justify-between px-4 bg-zinc-950/80 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-full hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => toggleStar(email.id)}
              className="p-2 rounded-full hover:bg-zinc-800 transition-colors"
            >
              <Star
                className={cn(
                  "w-5 h-5 transition-all",
                  email.starred ? "fill-yellow-500 text-yellow-500 drop-shadow-[0_0_8px_rgba(234,179,8,0.5)]" : "text-zinc-400"
                )}
              />
            </button>
            <button
              onClick={handleSave}
              className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors group"
              title="Save Email"
            >
              <Download className="w-5 h-5 group-hover:drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            </button>
            <button
              onClick={handlePrint}
              className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors group"
              title="Print"
            >
              <Printer className="w-5 h-5 group-hover:drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            </button>
            <button
              onClick={() => {
                deleteEmail(email.id);
                onBack();
              }}
              className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition-colors group"
            >
              <Trash2 className="w-5 h-5 group-hover:drop-shadow-[0_0_8px_rgba(248,113,113,0.5)]" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {email.folderId === 'drafts' && onEditDraft && (
            <button
              onClick={() => onEditDraft(email)}
              className="px-3 py-1.5 mr-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <Edit3 className="w-4 h-4" />
              Edit Further
            </button>
          )}
          <button
            onClick={() => onReply('reply', email)}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
          >
            <Reply className="w-5 h-5" />
          </button>
          <button
            onClick={() => onReply('replyAll', email)}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
          >
            <ReplyAll className="w-5 h-5" />
          </button>
          <button
            onClick={() => onReply('forward', email)}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
          >
            <Forward className="w-5 h-5" />
          </button>
          <button className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors">
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
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
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-100">{email.from.name}</span>
                  <span className="text-sm text-zinc-500">&lt;{email.from.email}&gt;</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
                  <span>to {email.to.map((t) => t.name).join(', ')}</span>
                  <button
                    onClick={() => setShowHeaders(!showHeaders)}
                    className="hover:text-emerald-400 transition-colors hover:underline"
                  >
                    {showHeaders ? 'Hide Details' : 'Show Details'}
                  </button>
                </div>
              </div>
            </div>
            <span className="text-sm text-zinc-500">
              {format(new Date(email.date), 'MMM d, yyyy, h:mm a')}
            </span>
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
                    <span>{email.headers.messageId}</span>
                  </div>
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

          <div
            className="prose prose-invert prose-zinc max-w-none prose-a:text-emerald-400 hover:prose-a:text-emerald-300 prose-p:leading-relaxed p-4 rounded-xl"
            style={{ 
              backgroundColor: settings.emailBackground || 'transparent', 
              color: settings.fontColor || 'inherit',
            } as React.CSSProperties}
            dangerouslySetInnerHTML={{ __html: email.body }}
          />

          {email.attachments.length > 0 && (
            <div className="mt-12 pt-8 border-t border-zinc-800/50">
              <h3 className="text-sm font-medium text-zinc-400 mb-4 flex items-center gap-2">
                <Paperclip className="w-4 h-4" />
                Attachments ({email.attachments.length})
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
                        
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                          <button className="p-2 bg-zinc-900/80 rounded-full text-zinc-200 hover:text-emerald-400 hover:scale-110 transition-all shadow-lg">
                            <Download className="w-5 h-5" />
                          </button>
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
          <div className="mt-12 pt-8 border-t border-zinc-800/50">
            <h3 className="text-sm font-medium text-emerald-400 mb-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              AI Suggested Replies
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
                <span className="text-sm text-zinc-500">Generating suggestions...</span>
              )}
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
