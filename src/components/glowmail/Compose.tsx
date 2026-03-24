import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMail } from '../../store';
import { Email, Contact, Attachment } from '../../types';
import { X, Send, Paperclip, Sparkles, Loader2, Bold, Italic, Underline, Link, Image as ImageIcon, List, ListOrdered, AlertTriangle, Trash2, ExternalLink, Tag, ChevronDown, Code, Terminal, Braces } from 'lucide-react';
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
  const [emailTags, setEmailTags] = useState<string[]>(initialData?.tags || []);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showCodeMenu, setShowCodeMenu] = useState(false);
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

  const [pendingSend, setPendingSend] = useState(false);
  const [subjectWarningShown, setSubjectWarningShown] = useState(false);
  const [attachmentWarningShown, setAttachmentWarningShown] = useState(false);

  const doSend = () => {
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
      tags: emailTags,
    });
    if (settings.delayedSending && settings.delayedSending > 0) {
      toast.success(t('compose.emailScheduled', lang, { minutes: String(settings.delayedSending) }));
    } else {
      toast.success(t('compose.emailSent', lang));
    }
    onClose();
  };

  const handleSend = () => {
    if (!to) {
      toast.error(t('compose.recipientRequired', lang));
      return;
    }

    // Warning: empty subject
    if (!subject.trim() && !subjectWarningShown) {
      setSubjectWarningShown(true);
      toast(lang === 'ru' ? 'Тема письма пустая. Нажмите «Отправить» ещё раз для подтверждения.' : 'Subject is empty. Press Send again to confirm.', { icon: '⚠️' });
      return;
    }

    // Warning: body mentions attachment but none attached
    const bodyText = (editorRef.current?.innerText || '').toLowerCase();
    const attachKeywords = lang === 'ru'
      ? ['вложен', 'прикреп', 'приложен', 'файл', 'прикладыва', 'attach']
      : ['attach', 'enclosed', 'file attached', 'see attached', 'find attached'];
    const mentionsAttachment = attachKeywords.some(kw => bodyText.includes(kw));
    if (mentionsAttachment && attachments.length === 0 && !attachmentWarningShown) {
      setAttachmentWarningShown(true);
      toast(lang === 'ru' ? 'Похоже, вы упомянули вложение, но файл не приложен. Нажмите «Отправить» ещё раз.' : 'You mentioned an attachment but none is attached. Press Send again to confirm.', { icon: '📎' });
      return;
    }

    doSend();
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
      tags: emailTags,
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

  const insertCodeElement = (type: 'inline' | 'block' | 'log') => {
    if (!editorRef.current) return;
    const sel = window.getSelection();
    const selectedText = sel?.toString() || '';
    setShowCodeMenu(false);

    if (type === 'inline') {
      const html = `<code style="background-color:#f4f4f5;color:#18181b;padding:2px 6px;border-radius:4px;font-family:'JetBrains Mono','Fira Code',Consolas,'Courier New',monospace;font-size:0.9em;border:1px solid #e4e4e7;">${selectedText || (lang === 'ru' ? 'код' : 'code')}</code>&nbsp;`;
      editorRef.current.focus();
      document.execCommand('insertHTML', false, html);
    } else if (type === 'block') {
      const placeholder = selectedText || (lang === 'ru' ? '// ваш код здесь' : '// your code here');
      const html = `<div style="margin:12px 0;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td style="background-color:#1e1e2e;border:1px solid #313244;border-radius:8px;padding:16px;font-family:'JetBrains Mono','Fira Code',Consolas,'Courier New',monospace;font-size:13px;line-height:1.5;color:#cdd6f4;white-space:pre-wrap;word-break:break-all;overflow-x:auto;" data-code-block="true">${placeholder}</td></tr></table></div><p><br></p>`;
      editorRef.current.focus();
      document.execCommand('insertHTML', false, html);
    } else if (type === 'log') {
      const placeholder = selectedText || (lang === 'ru' ? '$ команда или лог здесь' : '$ command or log output here');
      const html = `<div style="margin:12px 0;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td style="background-color:#0c0c0c;border:1px solid #333333;border-radius:8px;padding:16px;font-family:'JetBrains Mono','Fira Code',Consolas,'Courier New',monospace;font-size:13px;line-height:1.5;color:#00ff41;white-space:pre-wrap;word-break:break-all;overflow-x:auto;" data-code-block="log">${placeholder}</td></tr></table></div><p><br></p>`;
      editorRef.current.focus();
      document.execCommand('insertHTML', false, html);
    }
    setBody(editorRef.current.innerHTML);
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
                  const sigOptions = (settings.signatures || []).map(s => `<option value="${s.id}"${s.id === selectedSignatureId ? ' selected' : ''}>${s.name}</option>`).join('');
                  const sigDataJson = JSON.stringify(settings.signatures || []).replace(/"/g, '&quot;').replace(/'/g, "\\'");
                  const tagOptions = (settings.availableTags || []).map(t => `<option value="${t.name}">${t.name}</option>`).join('');
                  const edgeFnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-ai`;
                  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
                  const isLight = settings.theme === 'light';
                  const bg = isLight ? '#fafafa' : '#09090b';
                  const fg = isLight ? '#09090b' : '#f4f4f5';
                  const inputBg = isLight ? '#f4f4f5' : '#18181b';
                  const borderColor = isLight ? '#e4e4e7' : '#27272a';
                  const borderColorHover = isLight ? '#3f3f46' : '#3f3f46';
                  const mutedText = isLight ? '#52525b' : '#71717a';
                  const subtleBg = isLight ? '#e4e4e7' : '#27272a';
                  w.document.write(`<!DOCTYPE html><html><head><title>${t('compose.newMessage', lang)}</title>
                    <style>
                       * { margin: 0; padding: 0; box-sizing: border-box; }
                       @font-face { font-family: 'Involve'; src: url('${window.location.origin}/fonts/Involve-VF.ttf') format('truetype'); font-weight: 100 900; font-display: swap; }
                       body { font-family: '${settings.composerFont || 'Involve'}', 'Inter', system-ui, sans-serif; background: ${bg}; color: ${fg}; padding: 24px; }
                      .field { margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
                      .field label { color: ${mutedText}; font-size: 14px; min-width: 60px; }
                      .field input, .field select { flex: 1; background: ${inputBg}; border: 1px solid ${borderColor}; border-radius: 8px; padding: 8px 12px; color: ${fg}; font-size: 14px; outline: none; appearance: none; background-image: none; }
                      .field select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 8px center; padding-right: 28px; cursor: pointer; }
                      .field input:focus, .field select:focus { border-color: rgba(16,185,129,0.5); box-shadow: 0 0 0 1px rgba(16,185,129,0.5); }
                      .editor { background: ${inputBg}; border: 1px solid ${borderColor}; border-radius: 12px; padding: 16px; min-height: 300px; color: ${fg}; font-size: 14px; outline: none; margin-bottom: 16px; overflow-y: auto; }
                      .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 24px; background: #10b981; color: ${bg}; border: none; border-radius: 999px; font-weight: 600; font-size: 14px; cursor: pointer; }
                      .btn:hover { background: #34d399; }
                      .btn-draft { background: transparent; color: ${mutedText}; border: 1px solid ${borderColorHover}; border-radius: 999px; padding: 10px 20px; font-size: 14px; cursor: pointer; margin-right: 8px; }
                      .btn-draft:hover { background: ${subtleBg}; color: ${fg}; }
                      .toolbar { display: flex; gap: 4px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
                      .toolbar button, .toolbar select { background: ${subtleBg}; border: 1px solid ${borderColorHover}; border-radius: 6px; padding: 6px 8px; color: ${mutedText}; cursor: pointer; font-size: 12px; }
                      .toolbar button:hover, .toolbar select:hover { background: ${borderColorHover}; color: ${fg}; }
                      .toolbar .sep { width: 1px; height: 16px; background: ${borderColorHover}; margin: 0 4px; }
                      .toolbar input[type=color] { width: 24px; height: 24px; border: none; padding: 0; cursor: pointer; background: transparent; border-radius: 4px; }
                      .toolbar .ai-btn { background: linear-gradient(135deg, rgba(16,185,129,0.15), rgba(6,182,212,0.15)); border: 1px solid rgba(16,185,129,0.3); border-radius: 999px; padding: 5px 12px; color: #34d399; font-weight: 600; font-size: 12px; cursor: pointer; position: relative; display: inline-flex; align-items: center; gap: 5px; }
                      .toolbar .ai-btn:hover { background: linear-gradient(135deg, rgba(16,185,129,0.25), rgba(6,182,212,0.25)); }
                      .toolbar .ai-btn svg { width: 14px; height: 14px; }
                      .ai-menu { display: none; position: absolute; right: 0; top: 100%; margin-top: 4px; width: 180px; background: ${inputBg}; border: 1px solid ${borderColor}; border-radius: 12px; overflow: hidden; z-index: 100; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
                      .ai-menu.show { display: block; }
                      .ai-menu button { display: block; width: 100%; text-align: left; padding: 8px 12px; font-size: 13px; color: ${mutedText}; background: none; border: none; cursor: pointer; }
                      .ai-menu button:hover { background: ${subtleBg}; color: #34d399; }
                      .toolbar .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; }
                      .toolbar .icon-btn svg { width: 14px; height: 14px; }
                      .att-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
                      .att-item { display: flex; align-items: center; gap: 6px; padding: 4px 10px; background: ${subtleBg}; border-radius: 6px; font-size: 12px; color: ${mutedText}; }
                      .att-item button { background: none; border: none; color: ${mutedText}; cursor: pointer; padding: 0 2px; font-size: 14px; }
                      .att-item button:hover { color: #f87171; }
                      .footer-bar select { background: ${inputBg}; border: 1px solid ${borderColor}; border-radius: 8px; padding: 6px 28px 6px 10px; color: ${mutedText}; font-size: 13px; outline: none; cursor: pointer; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 8px center; }
                      .footer-bar select:focus { border-color: rgba(16,185,129,0.5); }
                    </style></head><body>
                    <h2 style="margin-bottom:16px;font-size:18px;">${t('compose.newMessage', lang)}</h2>
                    <div class="field"><label>${t('compose.to', lang)}</label><input id="to" value="${to}" /></div>
                    <div class="field"><label>${t('compose.cc', lang)}</label><input id="cc" value="${cc}" /></div>
                    <div class="field"><label>${t('compose.bcc', lang)}</label><input id="bcc" value="${bcc}" /></div>
                    <div class="field"><label>${t('compose.subjectLabel', lang)}</label><input id="subject" value="${subject}" /></div>
                    <div class="toolbar">
                      <select onchange="document.execCommand('fontName',false,this.value)">
                        <option value="Involve"${(settings.composerFont || 'Involve') === 'Involve' ? ' selected' : ''}>Involve</option><option value="Inter"${settings.composerFont === 'Inter' ? ' selected' : ''}>Inter</option><option value="Arial"${settings.composerFont === 'Arial' ? ' selected' : ''}>Arial</option><option value="Times New Roman"${settings.composerFont === 'Times New Roman' ? ' selected' : ''}>Times New Roman</option><option value="Courier New"${settings.composerFont === 'Courier New' ? ' selected' : ''}>Courier New</option>
                      </select>
                      <select onchange="document.execCommand('fontSize',false,this.value)">
                        <option value="1">${t('compose.small', lang)}</option><option value="3" selected>${t('compose.normal', lang)}</option><option value="5">${t('compose.large', lang)}</option><option value="7">${t('compose.huge', lang)}</option>
                      </select>
                      <span class="sep"></span>
                      <button onclick="document.execCommand('bold')" title="Bold"><b>B</b></button>
                      <button onclick="document.execCommand('italic')" title="Italic"><i>I</i></button>
                      <button onclick="document.execCommand('underline')" title="Underline"><u>U</u></button>
                      <span class="sep"></span>
                      <button onclick="document.execCommand('insertUnorderedList')" title="Bullet List">• List</button>
                      <button onclick="document.execCommand('insertOrderedList')" title="Numbered List">1. List</button>
                      <span class="sep"></span>
                      <input type="color" onchange="document.execCommand('foreColor',false,this.value)" title="${t('compose.textColor', lang)}" />
                      <input type="color" onchange="document.execCommand('hiliteColor',false,this.value)" title="${t('compose.highlightColor', lang)}" />
                      <span class="sep"></span>
                      <button class="icon-btn" onclick="var url=prompt('URL:');if(url)document.execCommand('createLink',false,url)" title="Link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>
                      <button class="icon-btn" onclick="var input=document.createElement('input');input.type='file';input.accept='image/*';input.onchange=function(e){var r=new FileReader();r.onload=function(ev){document.execCommand('insertImage',false,ev.target.result)};r.readAsDataURL(e.target.files[0])};input.click()" title="${t('compose.insertImage', lang)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></button>
                      <span class="sep"></span>
                      <div style="position:relative;display:inline-flex;">
                        <button class="icon-btn" onclick="var m=document.getElementById('code-menu');m.classList.toggle('show');" title="${lang === 'ru' ? 'Код' : 'Code'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></button>
                        <div class="ai-menu" id="code-menu">
                          <button onclick="insertCode('inline')">Inline code</button>
                          <button onclick="insertCode('block')">Code block</button>
                          <button onclick="insertCode('log')">${lang === 'ru' ? 'Лог / Терминал' : 'Log / Terminal'}</button>
                        </div>
                      </div>
                      <span class="sep"></span>
                      <div style="position:relative;display:inline-flex;">
                        <button class="ai-btn" onclick="var m=document.getElementById('ai-menu');m.classList.toggle('show');"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg> ${t('compose.aiMagic', lang)}</button>
                        <div class="ai-menu" id="ai-menu">
                          <button onclick="doAI('spellcheck')">${t('compose.proofread', lang)}</button>
                          <button onclick="doAI('professional')">${t('compose.makeProfessional', lang)}</button>
                          <button onclick="doAI('friendly')">${t('compose.makeFriendly', lang)}</button>
                          <button onclick="doAI('rewrite')">${t('compose.rewrite', lang)}</button>
                          <button onclick="doAI('translate')">${t('compose.autoTranslate', lang)}</button>
                        </div>
                      </div>
                    </div>
                    <div id="att-list" class="att-list"></div>
                    <div class="editor" contenteditable="true" id="body">${editorRef.current?.innerHTML || body}</div>
                    <div class="footer-bar">
                      <div style="display:flex;align-items:center;gap:8px;">
                        <button class="btn-draft" onclick="document.getElementById('file-attach').click();" style="padding:8px 12px;border-radius:8px;">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                        </button>
                        <input type="file" id="file-attach" multiple style="display:none;" onchange="addAttachments(this.files);this.value='';" />
                        <select id="sig-select" onchange="applySig(this.value)">
                          <option value="">${t('compose.noSignature', lang)}</option>
                          ${sigOptions}
                        </select>
                      </div>
                      <div style="display:flex;gap:8px;">
                        <button class="btn-draft" onclick="window.opener.postMessage({type:'glowmail-draft',to:document.getElementById('to').value,cc:document.getElementById('cc').value,bcc:document.getElementById('bcc').value,subject:document.getElementById('subject').value,body:document.getElementById('body').innerHTML},'*');window.close();">
                          ${t('compose.saveDraft', lang)}
                        </button>
                        <button class="btn" onclick="window.opener.postMessage({type:'glowmail-compose',to:document.getElementById('to').value,cc:document.getElementById('cc').value,bcc:document.getElementById('bcc').value,subject:document.getElementById('subject').value,body:document.getElementById('body').innerHTML},'*');window.close();">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;"><line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                          ${t('compose.send', lang)}
                        </button>
                      </div>
                    </div>
                    <script>
                      var attachments = [];
                      var sigData = ${JSON.stringify(settings.signatures || [])};
                      function addAttachments(files) {
                        var list = document.getElementById('att-list');
                        for(var i=0;i<files.length;i++) {
                          var f = files[i];
                          attachments.push(f);
                          var item = document.createElement('div');
                          item.className = 'att-item';
                          item.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> ' + f.name + ' <button onclick="this.parentElement.remove()">×</button>';
                          list.appendChild(item);
                        }
                      }
                      function applySig(id) {
                        var s = sigData.find(function(x){return x.id===id});
                        var ed = document.getElementById('body');
                        var old = ed.querySelector('.email-signature');
                        if(old) old.remove();
                        if(s && s.content) {
                          var d = document.createElement('div');
                          d.className = 'email-signature';
                          d.innerHTML = '<br>' + s.content;
                          var hr = ed.querySelector('hr');
                          if(hr) ed.insertBefore(d, hr);
                          else ed.appendChild(d);
                        }
                      }
                      function insertCode(type) {
                        document.getElementById('code-menu').classList.remove('show');
                        var ed = document.getElementById('body');
                        var sel = window.getSelection();
                        var txt = sel ? sel.toString() : '';
                        ed.focus();
                        if (type === 'inline') {
                          document.execCommand('insertHTML', false, '<code style="background-color:#f4f4f5;color:#18181b;padding:2px 6px;border-radius:4px;font-family:JetBrains Mono,Fira Code,Consolas,Courier New,monospace;font-size:0.9em;border:1px solid #e4e4e7;">' + (txt || 'code') + '</code>&nbsp;');
                        } else if (type === 'block') {
                          document.execCommand('insertHTML', false, '<div style="margin:12px 0;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td style="background-color:#1e1e2e;border:1px solid #313244;border-radius:8px;padding:16px;font-family:JetBrains Mono,Fira Code,Consolas,Courier New,monospace;font-size:13px;line-height:1.5;color:#cdd6f4;white-space:pre-wrap;word-break:break-all;">' + (txt || '// code here') + '</td></tr></table></div><p><br></p>');
                        } else {
                          document.execCommand('insertHTML', false, '<div style="margin:12px 0;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td style="background-color:#0c0c0c;border:1px solid #333;border-radius:8px;padding:16px;font-family:JetBrains Mono,Fira Code,Consolas,Courier New,monospace;font-size:13px;line-height:1.5;color:#00ff41;white-space:pre-wrap;word-break:break-all;">' + (txt || '$ output here') + '</td></tr></table></div><p><br></p>');
                        }
                      }
                      async function doAI(action) {
                        document.getElementById('ai-menu').classList.remove('show');
                        var ed = document.getElementById('body');
                        var full = ed.innerHTML;
                        var hrIdx = full.indexOf('<hr');
                        var userHtml = hrIdx!==-1 ? full.substring(0,hrIdx) : full;
                        var threadHtml = hrIdx!==-1 ? full.substring(hrIdx) : '';
                        var sigEl = ed.querySelector('.email-signature');
                        var sigHtml = sigEl ? sigEl.outerHTML : '';
                        if(sigEl) { userHtml = userHtml.replace(sigHtml, ''); }
                        var plain = userHtml.replace(/<[^>]*>/g,'').trim();
                        if(!plain) return;
                        try {
                          var resp = await fetch('${edgeFnUrl}', {
                            method:'POST',
                            headers:{'Content-Type':'application/json','Authorization':'Bearer ${anonKey}'},
                            body: JSON.stringify({action:action, text:plain})
                          });
                          var data = await resp.json();
                          if(data.result) {
                            ed.innerHTML = '<p>'+data.result.replace(/\\n/g,'<br>')+'</p>' + sigHtml + threadHtml;
                          }
                        } catch(e) { console.error(e); }
                      }
                    <\/script>
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

          {/* Tags Row */}
          <div className="flex items-center px-4 py-2 border-b border-zinc-800/50 bg-zinc-900/10 shrink-0">
            <span className="text-zinc-500 text-sm w-16">{t('compose.tagsLabel', lang)}</span>
            <div className="flex items-center gap-2 flex-wrap flex-1">
              {emailTags.map(tag => {
                const tagDef = settings.availableTags.find(t => t.name === tag);
                return (
                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-zinc-800/80 text-zinc-300 border border-zinc-700/50">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tagDef?.color || '#10b981' }} />
                    {tag}
                    <button onClick={() => setEmailTags(prev => prev.filter(t => t !== tag))} className="ml-0.5 text-zinc-500 hover:text-red-400">×</button>
                  </span>
                );
              })}
              <div className="relative">
                <button
                  onClick={() => setShowTagPicker(!showTagPicker)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <Tag className="w-3 h-3" />
                  +
                </button>
                {showTagPicker && (
                  <div className="absolute left-0 top-full mt-1 w-40 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50">
                    <div className="p-1.5 flex flex-col max-h-48 overflow-y-auto">
                      {settings.availableTags.filter(t => !emailTags.includes(t.name)).map(tag => (
                        <button
                          key={tag.id}
                          onClick={() => {
                            setEmailTags(prev => [...prev, tag.name]);
                            setShowTagPicker(false);
                          }}
                          className="flex items-center gap-2 text-left px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 rounded-lg transition-colors"
                        >
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-800/50 bg-zinc-900/30 shrink-0 overflow-x-auto overflow-y-visible relative" style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
          <select 
            onChange={(e) => execCommand('fontName', e.target.value)}
            defaultValue={settings.composerFont || 'Involve'}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 outline-none cursor-pointer mr-1"
          >
            <option value="Involve">Involve</option>
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
          <button onClick={() => {
            const url = prompt(lang === 'ru' ? 'Введите URL:' : 'Enter URL:');
            if (url) execCommand('createLink', url);
          }} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 transition-colors"><Link className="w-4 h-4" /></button>
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
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          {/* Code insertion dropdown */}
          <div className="relative">
            <button
              onClick={() => { setShowCodeMenu(!showCodeMenu); setShowAiMenu(false); }}
              className={cn("p-1.5 rounded hover:bg-zinc-800 text-zinc-400 transition-colors", showCodeMenu && "bg-zinc-800 text-zinc-200")}
              title={lang === 'ru' ? 'Вставить код' : 'Insert code'}
            >
              <Code className="w-4 h-4" />
            </button>
            {showCodeMenu && (
              <div className="absolute left-0 bottom-full mb-2 w-52 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-[60]">
                <div className="p-1 flex flex-col">
                  <span className="px-3 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{lang === 'ru' ? 'Вставить код' : 'Insert Code'}</span>
                  <button
                    onClick={() => insertCodeElement('inline')}
                    className="flex items-center gap-2.5 text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors"
                  >
                    <Braces className="w-4 h-4 text-zinc-500" />
                    <div>
                      <div className="font-medium">Inline code</div>
                      <div className="text-[11px] text-zinc-500">{lang === 'ru' ? 'Код внутри строки' : 'Code within text'}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => insertCodeElement('block')}
                    className="flex items-center gap-2.5 text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors"
                  >
                    <Code className="w-4 h-4 text-zinc-500" />
                    <div>
                      <div className="font-medium">Code block</div>
                      <div className="text-[11px] text-zinc-500">{lang === 'ru' ? 'Многострочный код' : 'Multi-line code'}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => insertCodeElement('log')}
                    className="flex items-center gap-2.5 text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-emerald-400 rounded-lg transition-colors"
                  >
                    <Terminal className="w-4 h-4 text-zinc-500" />
                    <div>
                      <div className="font-medium">{lang === 'ru' ? 'Лог / Терминал' : 'Log / Terminal'}</div>
                      <div className="text-[11px] text-zinc-500">{lang === 'ru' ? 'Логи, конфиги, вывод' : 'Logs, configs, output'}</div>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex-1" />
          
          {/* AI Assistant Button */}
          {settings.aiEnabled && <div className="relative">
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
          </div>}
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
            style={{ color: settings.fontColor || 'inherit', fontFamily: settings.composerFont || 'Involve' }}
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
        <div className="border-t border-zinc-800/50 flex flex-col sm:flex-row sm:items-center sm:justify-between px-3 sm:px-4 py-2 sm:py-0 sm:h-16 bg-zinc-950 shrink-0 gap-2 sm:gap-0">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleAttachment} 
            className="hidden" 
            multiple 
          />
          <div className="flex items-center gap-2 min-w-0">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors shrink-0"
              title={t('compose.attachFiles', lang)}
            >
              <Paperclip className="w-5 h-5" />
            </button>
            {settings.signatures && settings.signatures.length > 0 && (
              <select
                value={selectedSignatureId || ''}
                onChange={(e) => setSelectedSignatureId(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-300 px-2 py-1.5 focus:outline-none focus:border-emerald-500/50 min-w-0 max-w-[120px] sm:max-w-none truncate"
              >
                <option value="">{t('compose.noSignature', lang)}</option>
                {settings.signatures.map(sig => (
                  <option key={sig.id} value={sig.id}>{sig.name}</option>
                ))}
              </select>
            )}
          </div>
          
          <div className="flex items-center gap-2 justify-end">
            <button 
              onClick={handleSaveDraft}
              className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm font-medium transition-colors whitespace-nowrap"
            >
              {t('compose.saveDraft', lang)}
            </button>
            <button
              onClick={handleSend}
              className="flex items-center gap-2 px-5 sm:px-6 py-2 sm:py-2.5 bg-emerald-500 text-zinc-950 rounded-full font-semibold text-sm shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:shadow-[0_0_30px_rgba(16,185,129,0.6)] hover:scale-105 transition-all active:scale-95 whitespace-nowrap shrink-0"
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
