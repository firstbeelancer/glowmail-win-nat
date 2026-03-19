import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMail } from '../../store';
import { Email, Contact, Attachment } from '../../types';
import { X, Send, Paperclip, Sparkles, Loader2, Bold, Italic, Underline, Link, Image as ImageIcon, List, ListOrdered, AlertTriangle, Trash2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { t } from '@/lib/i18n';

export function Compose({
  onClose,
  initialData,
}: {
  onClose: () => void;
  initialData?: Partial<Email>;
}) {
  const { sendEmail, saveDraft, contacts, settings } = useMail();
  const lang = settings.language;
  const [to, setTo] = useState(initialData?.to?.map((c) => c.email).join(', ') || '');
  const [cc, setCc] = useState(initialData?.cc?.map((c) => c.email).join(', ') || '');
  const [bcc, setBcc] = useState(initialData?.bcc?.map((c) => c.email).join(', ') || '');
  const [showCcBcc, setShowCcBcc] = useState(true);
  const [subject, setSubject] = useState(initialData?.subject || '');
  const [body, setBody] = useState(initialData?.body || '');
  const [importance, setImportance] = useState<'high' | 'normal' | 'low'>(initialData?.importance || 'normal');
  const [attachments, setAttachments] = useState<Attachment[]>(initialData?.attachments || []);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showAiMenu, setShowAiMenu] = useState(false);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | undefined>(settings.defaultSignatureId || (settings.signatures?.length > 0 ? settings.signatures[0].id : undefined));
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Resizable state
  const [size, setSize] = useState({ width: 720, height: 600 });
  const isResizing = useRef(false);
  const startPos = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    startPos.current = { x: e.clientX, y: e.clientY, w: size.width, h: size.height };
    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const dw = startPos.current.x - ev.clientX;
      const dh = startPos.current.y - ev.clientY;
      setSize({
        width: Math.max(480, Math.min(1200, startPos.current.w + dw)),
        height: Math.max(400, Math.min(900, startPos.current.h + dh)),
      });
    };
    const handleMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [size]);

  useEffect(() => {
    if (editorRef.current && !editorRef.current.innerHTML) {
      // Build initial content with signature placed before quoted text
      let initialBody = body || '';
      if (selectedSignatureId) {
        const sig = settings.signatures?.find(s => s.id === selectedSignatureId);
        if (sig?.content) {
          const hrIndex = initialBody.indexOf('<hr>');
          if (hrIndex !== -1) {
            // Insert signature before the quoted/forwarded content
            initialBody = initialBody.slice(0, hrIndex) + `<br><div class="email-signature">${sig.content}</div><br>` + initialBody.slice(hrIndex);
          } else {
            initialBody = initialBody + `<br><br><div class="email-signature">${sig.content}</div>`;
          }
        }
      }
      editorRef.current.innerHTML = initialBody;
    }
  }, []);

  // Apply default font color to editor
  useEffect(() => {
    if (editorRef.current && settings.fontColor) {
      editorRef.current.style.color = settings.fontColor;
    }
  }, [settings.fontColor]);

  const handleSend = () => {
    if (!to) {
      toast.error(t('compose.recipientRequired', lang));
      return;
    }
    
    const toContacts: Contact[] = to.split(',').map((emailStr) => {
      const email = emailStr.trim();
      const existing = contacts.find((c) => c.email === email);
      return existing || { id: `c${Date.now()}`, name: email.split('@')[0], email };
    });

    const ccContacts: Contact[] = cc ? cc.split(',').map((emailStr) => {
      const email = emailStr.trim();
      const existing = contacts.find((c) => c.email === email);
      return existing || { id: `c${Date.now()}`, name: email.split('@')[0], email };
    }) : [];

    const bccContacts: Contact[] = bcc ? bcc.split(',').map((emailStr) => {
      const email = emailStr.trim();
      const existing = contacts.find((c) => c.email === email);
      return existing || { id: `c${Date.now()}`, name: email.split('@')[0], email };
    }) : [];

    const finalBody = editorRef.current?.innerHTML || '';

    sendEmail({
      id: initialData?.id,
      to: toContacts,
      cc: ccContacts,
      bcc: bccContacts,
      subject,
      body: finalBody,
      importance,
      attachments,
    });
    if (settings.delayedSending && settings.delayedSending > 0) {
      toast.success(t('compose.emailScheduled', lang, { minutes: String(settings.delayedSending) }));
    } else {
      toast.success(t('compose.emailSent', lang));
    }
    onClose();
  };

  const handleSaveDraft = () => {
    saveDraft({
      id: initialData?.id,
      to: [{ id: 'temp', name: to, email: to }],
      cc: cc ? [{ id: 'temp_cc', name: cc, email: cc }] : [],
      bcc: bcc ? [{ id: 'temp_bcc', name: bcc, email: bcc }] : [],
      subject,
      body: editorRef.current?.innerHTML || '',
      importance,
      attachments,
    });
    toast.success(t('compose.draftSaved', lang));
    onClose();
  };

  const handleAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const newAttachments = Array.from(files).map((file: File) => ({
        id: `a${Date.now()}-${file.name}`,
        name: file.name,
        size: file.size,
        type: file.type,
        url: URL.createObjectURL(file)
      }));
      setAttachments(prev => [...prev, ...newAttachments]);
    }
  };

  const execCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const handleAiAction = async (action: 'rewrite' | 'spellcheck' | 'professional' | 'friendly' | 'translate') => {
    if (!editorRef.current) return;
    const fullHtml = editorRef.current.innerHTML;
    
    // Split content: find the quoted thread (after <hr>) and signature
    const hrIndex = fullHtml.indexOf('<hr');
    const userHtml = hrIndex !== -1 ? fullHtml.substring(0, hrIndex) : fullHtml;
    const threadHtml = hrIndex !== -1 ? fullHtml.substring(hrIndex) : '';
    
    // Extract signature from user text if present
    const sigDivider = userHtml.lastIndexOf('--<br>');
    const sigIndex2 = userHtml.lastIndexOf('<p><br>--<br>');
    const sigStart = Math.max(sigDivider !== -1 ? userHtml.lastIndexOf('<p>', sigDivider) : -1, sigIndex2);
    
    let textToRewrite = sigStart !== -1 ? userHtml.substring(0, sigStart) : userHtml;
    const signatureHtml = sigStart !== -1 ? userHtml.substring(sigStart) : '';
    
    const plainText = textToRewrite.replace(/<[^>]*>/g, '').trim();
    if (!plainText) {
      toast.error(t('compose.writeFirst', lang));
      setShowAiMenu(false);
      return;
    }

    setIsAiLoading(true);
    setShowAiMenu(false);
    try {
      const { callEmailAI } = await import('@/lib/ai');
      const result = await callEmailAI({ action, text: plainText });
      const rewrittenHtml = `<p>${result.replace(/\n/g, '<br>')}</p>`;
      
      // Reassemble: rewritten text + signature + thread
      editorRef.current.innerHTML = rewrittenHtml + signatureHtml + threadHtml;
      setBody(editorRef.current.innerHTML);
      toast.success(t('compose.aiApplied', lang));
    } catch (err: any) {
      toast.error(err.message || 'AI request failed');
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 pointer-events-none"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto" onClick={handleSaveDraft} />
      
      <div
        className="bg-zinc-950 sm:rounded-2xl border border-zinc-800/50 shadow-2xl flex flex-col pointer-events-auto overflow-hidden relative"
        style={{
          width: '100%',
          height: '100%',
          maxWidth: `${size.width}px`,
          maxHeight: `${size.height}px`,
        }}
      >
        {/* Resize handle (top-left corner) */}
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize z-10 group hidden sm:block"
          title="Drag to resize"
        >
          <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-zinc-600 group-hover:border-emerald-400 transition-colors" />
        </div>

        {/* Header */}
        <div className="h-14 border-b border-zinc-800/50 flex items-center justify-between px-4 bg-zinc-900/50 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-100">{t('compose.newMessage', lang)}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const w = window.open('', '_blank', 'width=800,height=700,menubar=no,toolbar=no,status=no');
                if (w) {
                  w.document.write(`<!DOCTYPE html><html><head><title>${t('compose.newMessage', lang)}</title>
                    <style>
                      * { margin: 0; padding: 0; box-sizing: border-box; }
                      body { font-family: 'Involve', system-ui, sans-serif; background: #09090b; color: #f4f4f5; padding: 24px; }
                      .field { margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
                      .field label { color: #71717a; font-size: 14px; min-width: 60px; }
                      .field input, .field select { flex: 1; background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 8px 12px; color: #f4f4f5; font-size: 14px; outline: none; }
                      .field input:focus, .field select:focus { border-color: rgba(16,185,129,0.5); }
                      .editor { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 16px; min-height: 300px; color: #e4e4e7; font-size: 14px; outline: none; margin-bottom: 16px; }
                      .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 24px; background: #10b981; color: #09090b; border: none; border-radius: 999px; font-weight: 600; font-size: 14px; cursor: pointer; }
                      .btn:hover { background: #34d399; }
                      .toolbar { display: flex; gap: 4px; margin-bottom: 12px; }
                      .toolbar button { background: #27272a; border: 1px solid #3f3f46; border-radius: 6px; padding: 6px 8px; color: #a1a1aa; cursor: pointer; font-size: 12px; }
                      .toolbar button:hover { background: #3f3f46; color: #f4f4f5; }
                    </style></head><body>
                    <h2 style="margin-bottom:16px;font-size:18px;">${t('compose.newMessage', lang)}</h2>
                    <div class="field"><label>${t('compose.to', lang)}</label><input id="to" value="${to}" /></div>
                    <div class="field"><label>${t('compose.subjectLabel', lang)}</label><input id="subject" value="${subject}" /></div>
                    <div class="toolbar">
                      <button onclick="document.execCommand('bold')"><b>B</b></button>
                      <button onclick="document.execCommand('italic')"><i>I</i></button>
                      <button onclick="document.execCommand('underline')"><u>U</u></button>
                    </div>
                    <div class="editor" contenteditable="true" id="body">${editorRef.current?.innerHTML || body}</div>
                    <div style="display:flex;justify-content:flex-end;">
                      <button class="btn" onclick="window.opener.postMessage({type:'glowmail-compose',to:document.getElementById('to').value,subject:document.getElementById('subject').value,body:document.getElementById('body').innerHTML},'*');window.close();">
                        ✉ ${t('compose.send', lang)}
                      </button>
                    </div>
                  </body></html>`);
                  w.document.close();
                  onClose();
                }
              }}
              className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
              title={t('layout.openInWindow', lang)}
            >
              <ExternalLink className="w-4 h-4" />
            </button>
            <button
              onClick={handleSaveDraft}
              className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form Fields */}
        <div className="flex flex-col shrink-0">
          <div className="flex items-center px-4 py-3 border-b border-zinc-800/50 focus-within:bg-zinc-900/30 transition-colors relative">
            <span className="text-zinc-500 text-sm w-16">{t('compose.to', lang)}</span>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-sm text-zinc-100 placeholder:text-zinc-600"
              placeholder="recipient@example.com"
              autoFocus
            />
            <button 
              onClick={() => setShowCcBcc(!showCcBcc)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors ml-2"
            >
              {showCcBcc ? t('compose.hideCcBcc', lang) : t('compose.showCcBcc', lang)}
            </button>
          </div>
          
          {showCcBcc && (
            <>
              <div className="flex items-center px-4 py-3 border-b border-zinc-800/50 focus-within:bg-zinc-900/30 transition-colors">
                <span className="text-zinc-500 text-sm w-16">{t('compose.cc', lang)}</span>
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  className="flex-1 bg-transparent border-none outline-none text-sm text-zinc-100 placeholder:text-zinc-600"
                  placeholder="cc@example.com"
                />
              </div>
              <div className="flex items-center px-4 py-3 border-b border-zinc-800/50 focus-within:bg-zinc-900/30 transition-colors">
                <span className="text-zinc-500 text-sm w-16">{t('compose.bcc', lang)}</span>
                <input
                  type="text"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  className="flex-1 bg-transparent border-none outline-none text-sm text-zinc-100 placeholder:text-zinc-600"
                  placeholder="bcc@example.com"
                />
              </div>
            </>
          )}

          <div className="flex items-center px-4 py-3 border-b border-zinc-800/50 focus-within:bg-zinc-900/30 transition-colors">
            <span className="text-zinc-500 text-sm w-16">{t('compose.subjectLabel', lang)}</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-sm text-zinc-100 font-medium placeholder:text-zinc-600"
              placeholder={t('compose.subjectPlaceholder', lang)}
            />
            <div className="flex items-center gap-2 ml-4">
              <span className="text-xs text-zinc-500">{t('compose.importance', lang)}</span>
              <select
                value={importance}
                onChange={(e) => setImportance(e.target.value as 'high' | 'normal' | 'low')}
                className={cn(
                  "bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs outline-none cursor-pointer transition-colors",
                  importance === 'high' ? "text-red-400 border-red-500/30 bg-red-500/10" :
                  importance === 'low' ? "text-zinc-400" : "text-emerald-400"
                )}
              >
                <option value="high">{t('compose.high', lang)}</option>
                <option value="normal">{t('compose.normal', lang)}</option>
                <option value="low">{t('compose.low', lang)}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-800/50 bg-zinc-900/30 shrink-0 overflow-visible relative">
          <select 
            onChange={(e) => execCommand('fontName', e.target.value)}
            defaultValue="Inter"
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 outline-none cursor-pointer mr-1"
          >
            <option value="Inter">Inter</option>
            <option value="Arial">Arial</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Courier New">Courier New</option>
            <option value="Arimo">Arimo</option>
            {settings.customFonts?.map(font => (
              <option key={font.name} value={font.name}>{font.name}</option>
            ))}
          </select>
          <select 
            onChange={(e) => execCommand('fontSize', e.target.value)}
            defaultValue="3"
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 outline-none cursor-pointer mr-2"
          >
            <option value="1">{t('compose.small', lang)}</option>
            <option value="3">{t('compose.normal', lang)}</option>
            <option value="5">{t('compose.large', lang)}</option>
            <option value="7">{t('compose.huge', lang)}</option>
          </select>
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          <button onClick={() => execCommand('bold')} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 transition-colors"><Bold className="w-4 h-4" /></button>
          <button onClick={() => execCommand('italic')} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 transition-colors"><Italic className="w-4 h-4" /></button>
          <button onClick={() => execCommand('underline')} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 transition-colors"><Underline className="w-4 h-4" /></button>
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          <button onClick={() => execCommand('insertUnorderedList')} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 transition-colors"><List className="w-4 h-4" /></button>
          <button onClick={() => execCommand('insertOrderedList')} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 transition-colors"><ListOrdered className="w-4 h-4" /></button>
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          <div className="flex items-center gap-1">
            <input type="color" onChange={(e) => execCommand('foreColor', e.target.value)} className="w-6 h-6 p-0 border-0 rounded cursor-pointer bg-transparent" title={t('compose.textColor', lang)} />
            <input type="color" onChange={(e) => execCommand('hiliteColor', e.target.value)} className="w-6 h-6 p-0 border-0 rounded cursor-pointer bg-transparent" title={t('compose.highlightColor', lang)} />
          </div>
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          <button onClick={() => {}} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 transition-colors"><Link className="w-4 h-4" /></button>
          <input
            type="file"
            accept="image/*"
            ref={imageInputRef}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                  execCommand('insertImage', event.target?.result as string);
                };
                reader.readAsDataURL(file);
              }
              if (imageInputRef.current) imageInputRef.current.value = '';
            }}
          />
          <button onClick={() => imageInputRef.current?.click()} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 transition-colors" title={t('compose.insertImage', lang)}><ImageIcon className="w-4 h-4" /></button>
          
          <div className="flex-1" />
          
          {/* AI Assistant Button */}
          <div className="relative">
            <button
              onClick={() => setShowAiMenu(!showAiMenu)}
              disabled={isAiLoading}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                isAiLoading
                  ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 text-emerald-400 hover:from-emerald-500/30 hover:to-cyan-500/30 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.15)] hover:shadow-[0_0_20px_rgba(16,185,129,0.25)]"
              )}
            >
              {isAiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {t('compose.aiMagic', lang)}
            </button>

            {showAiMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-[60]">
                <div className="p-1 flex flex-col">
                  <button onClick={() => handleAiAction('spellcheck')} className="text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors">{t('compose.proofread', lang)}</button>
                  <button onClick={() => handleAiAction('professional')} className="text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors">{t('compose.makeProfessional', lang)}</button>
                  <button onClick={() => handleAiAction('friendly')} className="text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors">{t('compose.makeFriendly', lang)}</button>
                  <button onClick={() => handleAiAction('rewrite')} className="text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors">{t('compose.rewrite', lang)}</button>
                  <button onClick={() => handleAiAction('translate')} className="text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors">{t('compose.autoTranslate', lang)}</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Editor */}
        <div 
          className="flex-1 overflow-y-auto p-4 cursor-text relative group"
          style={{ 
            backgroundColor: settings.emailBackground || 'transparent', 
          } as React.CSSProperties}
        >
          <div
            ref={editorRef}
            contentEditable
            className="min-h-full outline-none text-sm max-w-none"
            style={{ color: settings.fontColor || 'inherit' }}
            onInput={(e) => setBody((e.target as HTMLDivElement).innerHTML)}
          />
          {!body && (
            <div className="absolute top-4 left-4 text-sm text-zinc-600 pointer-events-none">
              {t('compose.placeholder', lang)}
            </div>
          )}
        </div>

        {/* Attachments Preview */}
        {attachments.length > 0 && (
          <div className="px-4 py-2 border-t border-zinc-800/50 bg-zinc-900/30 flex flex-wrap gap-2 shrink-0">
            {attachments.map(att => (
              <div key={att.id} className="flex items-center gap-2 px-2 py-1 bg-zinc-800 rounded-md text-xs text-zinc-300">
                <Paperclip className="w-3 h-3 text-zinc-500" />
                <span className="max-w-[150px] truncate">{att.name}</span>
                <button 
                  onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
                  className="p-0.5 hover:bg-zinc-700 rounded-full text-zinc-400 hover:text-red-400 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="h-16 border-t border-zinc-800/50 flex items-center justify-between px-4 bg-zinc-950 shrink-0">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleAttachment} 
            className="hidden" 
            multiple 
          />
          <div className="flex items-center gap-2">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
              title={t('compose.attachFiles', lang)}
            >
              <Paperclip className="w-5 h-5" />
            </button>
            {settings.signatures && settings.signatures.length > 0 && (
              <select
                value={selectedSignatureId || ''}
                onChange={(e) => setSelectedSignatureId(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-300 px-2 py-1.5 focus:outline-none focus:border-emerald-500/50"
              >
                <option value="">{t('compose.noSignature', lang)}</option>
                {settings.signatures.map(sig => (
                  <option key={sig.id} value={sig.id}>{sig.name}</option>
                ))}
              </select>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={handleSaveDraft}
              className="px-4 py-2.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm font-medium transition-colors"
            >
              {t('compose.saveDraft', lang)}
            </button>
            <button
              onClick={handleSend}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 text-zinc-950 rounded-full font-semibold text-sm shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:shadow-[0_0_30px_rgba(16,185,129,0.6)] hover:scale-105 transition-all active:scale-95"
            >
              <Send className="w-4 h-4" />
              {t('compose.send', lang)}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
