import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMail } from '../../store';
import { Email, Contact, Attachment } from '../../types';
import { X, Send, Paperclip, Sparkles, Loader2, Bold, Italic, Underline, Link, Image as ImageIcon, List, ListOrdered, AlertTriangle, Trash2, ExternalLink, Tag, ChevronDown, Code, Terminal, Braces, Shield, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { t } from '@/lib/i18n';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { pgpSignMessage, pgpEncryptMessage } from '@/lib/mail-api';

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
  const [showCcBcc, setShowCcBcc] = useState(!!(initialData?.cc?.length || initialData?.bcc?.length));
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

  // Per-message crypto toggles (initialized from global settings)
  const [signThis, setSignThis] = useState(settings.cryptoSignOutgoing || false);
  const [encryptThis, setEncryptThis] = useState(settings.cryptoEncryptOutgoing || false);

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

  // Image resize functionality in editor
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    let activeImg: HTMLImageElement | null = null;
    let resizeOverlay: HTMLDivElement | null = null;

    const removeOverlay = () => {
      if (resizeOverlay && resizeOverlay.parentNode) {
        resizeOverlay.parentNode.removeChild(resizeOverlay);
      }
      resizeOverlay = null;
      activeImg = null;
    };

    const createOverlay = (img: HTMLImageElement) => {
      removeOverlay();
      activeImg = img;

      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:absolute;pointer-events:none;z-index:50;';
      wrapper.setAttribute('data-img-resize-overlay', 'true');

      const updatePosition = () => {
        if (!activeImg || !editor) return;
        const editorRect = editor.getBoundingClientRect();
        const imgRect = activeImg.getBoundingClientRect();
        wrapper.style.left = `${imgRect.left - editorRect.left + editor.scrollLeft}px`;
        wrapper.style.top = `${imgRect.top - editorRect.top + editor.scrollTop}px`;
        wrapper.style.width = `${imgRect.width}px`;
        wrapper.style.height = `${imgRect.height}px`;
      };
      updatePosition();

      // Border
      wrapper.style.border = '2px solid #10b981';
      wrapper.style.borderRadius = '2px';

      // Size label
      const sizeLabel = document.createElement('div');
      sizeLabel.style.cssText = 'position:absolute;top:-24px;left:50%;transform:translateX(-50%);background:#10b981;color:#000;font-size:11px;padding:2px 6px;border-radius:4px;white-space:nowrap;pointer-events:none;font-weight:600;';
      sizeLabel.textContent = `${Math.round(img.width)} × ${Math.round(img.height)}`;
      wrapper.appendChild(sizeLabel);

      // Resize handle (bottom-right)
      const handle = document.createElement('div');
      handle.style.cssText = 'position:absolute;right:-5px;bottom:-5px;width:12px;height:12px;background:#10b981;border-radius:2px;cursor:nwse-resize;pointer-events:auto;';
      wrapper.appendChild(handle);

      // Resize handle (bottom-left)
      const handleBL = document.createElement('div');
      handleBL.style.cssText = 'position:absolute;left:-5px;bottom:-5px;width:12px;height:12px;background:#10b981;border-radius:2px;cursor:nesw-resize;pointer-events:auto;';
      wrapper.appendChild(handleBL);

      const startResize = (e: MouseEvent, corner: 'br' | 'bl') => {
        e.preventDefault();
        e.stopPropagation();
        if (!activeImg) return;
        const startX = e.clientX;
        const startW = activeImg.width;
        const aspectRatio = activeImg.naturalHeight / activeImg.naturalWidth;

        const onMove = (ev: MouseEvent) => {
          if (!activeImg) return;
          const dx = corner === 'br' ? ev.clientX - startX : startX - ev.clientX;
          const newW = Math.max(32, startW + dx);
          activeImg.style.width = `${newW}px`;
          activeImg.style.height = `${Math.round(newW * aspectRatio)}px`;
          activeImg.removeAttribute('width');
          activeImg.removeAttribute('height');
          updatePosition();
          sizeLabel.textContent = `${Math.round(newW)} × ${Math.round(newW * aspectRatio)}`;
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          setBody(editor.innerHTML);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      };

      handle.addEventListener('mousedown', (e) => startResize(e, 'br'));
      handleBL.addEventListener('mousedown', (e) => startResize(e, 'bl'));

      editor.style.position = 'relative';
      editor.appendChild(wrapper);
      resizeOverlay = wrapper;
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG' && editor.contains(target)) {
        createOverlay(target as HTMLImageElement);
      } else if (!(target as HTMLElement).hasAttribute?.('data-img-resize-overlay') && !resizeOverlay?.contains(target)) {
        removeOverlay();
      }
    };

    const handleInput = () => {
      removeOverlay();
    };

    editor.addEventListener('click', handleClick);
    editor.addEventListener('input', handleInput);
    document.addEventListener('click', (e) => {
      if (!editor.contains(e.target as Node) && !resizeOverlay?.contains(e.target as Node)) {
        removeOverlay();
      }
    });

    return () => {
      editor.removeEventListener('click', handleClick);
      editor.removeEventListener('input', handleInput);
      removeOverlay();
    };
  }, []);

  const [pendingSend, setPendingSend] = useState(false);
  const [subjectWarningShown, setSubjectWarningShown] = useState(false);
  const [attachmentWarningShown, setAttachmentWarningShown] = useState(false);

  const [isCryptoProcessing, setIsCryptoProcessing] = useState(false);

  const doSend = async () => {
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

    let finalBody = editorRef.current?.innerHTML || '';
    const plainText = editorRef.current?.innerText || '';

    // Apply PGP signing/encryption if enabled
    if (settings.cryptoPreferredType === 'pgp') {
      try {
        setIsCryptoProcessing(true);

        if (signThis && settings.cryptoKeys?.pgpPrivateKey) {
          const result = await pgpSignMessage({
            text: plainText,
            privateKeyArmored: settings.cryptoKeys.pgpPrivateKey,
            passphrase: settings.cryptoKeys.pgpPassphrase,
          });
          finalBody = `<pre style="white-space:pre-wrap">${result.signed}</pre>`;
        }

        if (encryptThis && settings.cryptoKeys?.pgpPublicKey) {
          const recipientKeys = [settings.cryptoKeys.pgpPublicKey];
          const result = await pgpEncryptMessage({
            text: plainText,
            recipientPublicKeys: recipientKeys,
            privateKeyArmored: signThis ? settings.cryptoKeys.pgpPrivateKey : undefined,
            passphrase: settings.cryptoKeys.pgpPassphrase,
          });
          finalBody = `<pre style="white-space:pre-wrap">${result.encrypted}</pre>`;
        }
      } catch (e) {
        toast.error(lang === 'ru' ? 'Ошибка криптографии: ' + (e instanceof Error ? e.message : '') : 'Crypto error: ' + (e instanceof Error ? e.message : ''));
        setIsCryptoProcessing(false);
        return;
      } finally {
        setIsCryptoProcessing(false);
      }
    }

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
                  const tagOptions = (settings.availableTags || []).map(t => `<option value="${t.name}">${t.name}</option>`).join('');
                  const aiConfigJson = JSON.stringify({
                    enabled: settings.aiEnabled,
                    provider: settings.aiProvider || 'openai',
                    apiKey: settings.aiApiKey || '',
                    model: settings.aiModel || (settings.aiProvider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4.1-mini'),
                    baseUrl: settings.aiBaseUrl || '',
                  }).replace(/</g, '\\u003c');
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
                    <div class="field"><label>${t('compose.to', lang)}</label><input id="to" value="${to}" /><a href="#" id="toggle-ccbcc" onclick="var el=document.getElementById('ccbcc-rows');el.style.display=el.style.display==='none'?'':'none';this.textContent=el.style.display==='none'?'${lang === 'ru' ? 'Копия/Скрытая' : 'Cc/Bcc'}':'${lang === 'ru' ? 'Скрыть' : 'Hide'}';return false;" style="color:${mutedText};font-size:12px;white-space:nowrap;text-decoration:none;">${lang === 'ru' ? 'Копия/Скрытая' : 'Cc/Bcc'}</a></div>
                    <div id="ccbcc-rows" style="display:none;">
                    <div class="field"><label>${t('compose.cc', lang)}</label><input id="cc" value="${cc}" /></div>
                    <div class="field"><label>${t('compose.bcc', lang)}</label><input id="bcc" value="${bcc}" /></div>
                    </div>
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
                    <style>
                      .crypto-toggle { display:inline-flex; align-items:center; gap:4px; padding:4px 8px; border-radius:8px; font-size:12px; font-weight:500; border:1px solid; cursor:pointer; transition:all 0.2s; background:none; }
                      .crypto-toggle.active-sign { background:rgba(16,185,129,0.1); color:#34d399; border-color:rgba(16,185,129,0.2); }
                      .crypto-toggle.inactive { background:${subtleBg}; color:${mutedText}; border-color:${borderColor}; }
                      .crypto-toggle.inactive:hover { color:${fg}; }
                      .crypto-toggle.active-enc { background:rgba(245,158,11,0.1); color:#fbbf24; border-color:rgba(245,158,11,0.2); }
                      .crypto-toggle svg { width:12px; height:12px; }
                    </style>
                    <div class="footer-bar">
                      <div style="display:flex;align-items:center;gap:8px;">
                        <button class="btn-draft" onclick="document.getElementById('file-attach').click();" style="padding:8px 12px;border-radius:8px;">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                        </button>
                        <input type="file" id="file-attach" multiple style="display:none;" onchange="addAttachments(this.files);this.value='';" />
                        <button id="sign-toggle" class="crypto-toggle ${signThis ? 'active-sign' : 'inactive'}" onclick="toggleSign()">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
                          ${settings.cryptoPreferredType === 'smime' ? 'S/MIME' : 'PGP'}
                        </button>
                        <button id="enc-toggle" class="crypto-toggle ${encryptThis ? 'active-enc' : 'inactive'}" onclick="toggleEnc()">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                          ${lang === 'ru' ? 'Шифр.' : 'Enc.'}
                        </button>
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
                      var aiConfig = ${aiConfigJson};
                      var signEnabled = ${signThis};
                      var encEnabled = ${encryptThis};
                      function toggleSign() {
                        signEnabled = !signEnabled;
                        var btn = document.getElementById('sign-toggle');
                        btn.className = 'crypto-toggle ' + (signEnabled ? 'active-sign' : 'inactive');
                      }
                      function toggleEnc() {
                        encEnabled = !encEnabled;
                        var btn = document.getElementById('enc-toggle');
                        btn.className = 'crypto-toggle ' + (encEnabled ? 'active-enc' : 'inactive');
                      }
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
                        if(!aiConfig.enabled) {
                          alert('${lang === 'ru' ? 'ИИ выключен в настройках.' : 'AI is disabled in settings.'}');
                          return;
                        }
                        if(!aiConfig.apiKey) {
                          alert('${lang === 'ru' ? 'Сначала добавь AI API-ключ в настройках.' : 'Add an AI API key in settings first.'}');
                          return;
                        }
                        try {
                          var prompts = {
                            rewrite: {
                              systemPrompt: 'You are an email writing assistant. Rewrite the given text to be clearer and more concise. Return only the rewritten text, no explanations.',
                              userPrompt: plain
                            },
                            spellcheck: {
                              systemPrompt: 'You are a proofreader. Fix all spelling and grammar errors in the given text. Return only the corrected text, no explanations.',
                              userPrompt: plain
                            },
                            professional: {
                              systemPrompt: 'You are an email writing assistant. Rewrite the given text in a professional, formal tone. Return only the rewritten text, no explanations.',
                              userPrompt: plain
                            },
                            friendly: {
                              systemPrompt: 'You are an email writing assistant. Rewrite the given text in a warm, friendly tone. Return only the rewritten text, no explanations.',
                              userPrompt: plain
                            },
                            translate: {
                              systemPrompt: 'You are a translator. Translate the given text to English. If it\\'s already in English, translate to Spanish. Return only the translated text, no explanations.',
                              userPrompt: plain
                            }
                          };
                          var prompt = prompts[action];
                          if(!prompt) return;
                          var result = '';
                          if(aiConfig.provider === 'gemini') {
                            var geminiResp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(aiConfig.model || 'gemini-2.5-flash') + ':generateContent?key=' + encodeURIComponent(aiConfig.apiKey), {
                              method:'POST',
                              headers:{'Content-Type':'application/json'},
                              body: JSON.stringify({
                                systemInstruction: { parts: [{ text: prompt.systemPrompt }] },
                                contents: [{ role:'user', parts:[{ text: prompt.userPrompt }] }],
                                generationConfig: { temperature: 0.4 }
                              })
                            });
                            if(!geminiResp.ok) throw new Error(await geminiResp.text());
                            var geminiData = await geminiResp.json();
                            result = (((geminiData || {}).candidates || [])[0]?.content?.parts || []).map(function(part){ return typeof part?.text === 'string' ? part.text : ''; }).join('').trim();
                          } else {
                            var baseUrl = (aiConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
                            var resp = await fetch(baseUrl + '/chat/completions', {
                              method:'POST',
                              headers:{'Content-Type':'application/json','Authorization':'Bearer ' + aiConfig.apiKey},
                              body: JSON.stringify({
                                model: aiConfig.model || 'gpt-4.1-mini',
                                temperature: 0.4,
                                messages: [
                                  { role:'system', content: prompt.systemPrompt },
                                  { role:'user', content: prompt.userPrompt }
                                ]
                              })
                            });
                            if(!resp.ok) throw new Error(await resp.text());
                            var data = await resp.json();
                            var content = (((data || {}).choices || [])[0]?.message?.content);
                            if(typeof content === 'string') result = content.trim();
                            else if(Array.isArray(content)) result = content.map(function(part){ return typeof part === 'string' ? part : (part?.type === 'text' ? (part.text || '') : ''); }).join('').trim();
                          }
                          if(result) {
                            ed.innerHTML = '<p>'+result.replace(/\\n/g,'<br>')+'</p>' + sigHtml + threadHtml;
                          }
                        } catch(e) {
                          console.error(e);
                          alert((e && e.message) ? e.message : 'AI request failed');
                        }
                      }
                      // Image resize functionality
                      (function() {
                        var editor = document.getElementById('body');
                        var activeImg = null;
                        var overlay = null;
                        function removeOverlay() {
                          if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                          overlay = null; activeImg = null;
                        }
                        function createOverlay(img) {
                          removeOverlay();
                          activeImg = img;
                          var w = document.createElement('div');
                          w.setAttribute('data-img-overlay','1');
                          w.style.cssText = 'position:absolute;pointer-events:none;z-index:50;border:2px solid #10b981;border-radius:2px;';
                          var label = document.createElement('div');
                          label.style.cssText = 'position:absolute;top:-24px;left:50%;transform:translateX(-50%);background:#10b981;color:#000;font-size:11px;padding:2px 6px;border-radius:4px;white-space:nowrap;pointer-events:none;font-weight:600;';
                          label.textContent = Math.round(img.width) + ' × ' + Math.round(img.height);
                          w.appendChild(label);
                          function makeHandle(css, corner) {
                            var h = document.createElement('div');
                            h.style.cssText = 'position:absolute;width:12px;height:12px;background:#10b981;border-radius:2px;pointer-events:auto;cursor:' + (corner==='br'?'nwse':'nesw') + '-resize;' + css;
                            h.addEventListener('mousedown', function(e) {
                              e.preventDefault(); e.stopPropagation();
                              if (!activeImg) return;
                              var startX = e.clientX, startW = activeImg.width;
                              var ar = activeImg.naturalHeight / activeImg.naturalWidth;
                              function onMove(ev) {
                                if (!activeImg) return;
                                var dx = corner==='br' ? ev.clientX-startX : startX-ev.clientX;
                                var nw = Math.max(32, startW+dx);
                                activeImg.style.width = nw+'px';
                                activeImg.style.height = Math.round(nw*ar)+'px';
                                activeImg.removeAttribute('width'); activeImg.removeAttribute('height');
                                updatePos(); label.textContent = Math.round(nw)+' × '+Math.round(nw*ar);
                              }
                              function onUp() { document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); }
                              document.addEventListener('mousemove',onMove);
                              document.addEventListener('mouseup',onUp);
                            });
                            return h;
                          }
                          w.appendChild(makeHandle('right:-5px;bottom:-5px;','br'));
                          w.appendChild(makeHandle('left:-5px;bottom:-5px;','bl'));
                          function updatePos() {
                            if (!activeImg || !editor) return;
                            var er = editor.getBoundingClientRect(), ir = activeImg.getBoundingClientRect();
                            w.style.left = (ir.left-er.left+editor.scrollLeft)+'px';
                            w.style.top = (ir.top-er.top+editor.scrollTop)+'px';
                            w.style.width = ir.width+'px'; w.style.height = ir.height+'px';
                          }
                          updatePos();
                          editor.style.position = 'relative';
                          editor.appendChild(w);
                          overlay = w;
                        }
                        editor.addEventListener('click', function(e) {
                          if (e.target.tagName === 'IMG') createOverlay(e.target);
                          else if (!e.target.hasAttribute('data-img-overlay') && (!overlay || !overlay.contains(e.target))) removeOverlay();
                        });
                        editor.addEventListener('input', removeOverlay);
                        document.addEventListener('click', function(e) {
                          if (!editor.contains(e.target) && (!overlay || !overlay.contains(e.target))) removeOverlay();
                        });
                      })();
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
              <Select
                value={importance}
                onValueChange={(v) => setImportance(v as 'high' | 'normal' | 'low')}
              >
                <SelectTrigger className={cn(
                  "w-auto h-7 px-2 text-xs gap-1 rounded-lg",
                  importance === 'high' ? "text-red-400 border-red-500/30 bg-red-500/10" :
                  importance === 'low' ? "text-muted-foreground" : "text-primary"
                )}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">{t('compose.high', lang)}</SelectItem>
                  <SelectItem value="normal">{t('compose.normal', lang)}</SelectItem>
                  <SelectItem value="low">{t('compose.low', lang)}</SelectItem>
                </SelectContent>
              </Select>
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

        <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-800/50 bg-zinc-900/30 shrink-0 overflow-visible relative" style={{ scrollbarWidth: 'none' }}>
          <Select
            onValueChange={(v) => execCommand('fontName', v)}
            defaultValue={settings.composerFont || 'Involve'}
          >
            <SelectTrigger className="w-auto h-7 px-2 text-xs gap-1 rounded-lg mr-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Involve">Involve</SelectItem>
              <SelectItem value="Inter">Inter</SelectItem>
              <SelectItem value="Arial">Arial</SelectItem>
              <SelectItem value="Times New Roman">Times New Roman</SelectItem>
              <SelectItem value="Courier New">Courier New</SelectItem>
              <SelectItem value="Arimo">Arimo</SelectItem>
              {settings.customFonts?.map(font => (
                <SelectItem key={font.name} value={font.name}>{font.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            onValueChange={(v) => execCommand('fontSize', v)}
            defaultValue="3"
          >
            <SelectTrigger className="w-auto h-7 px-2 text-xs gap-1 rounded-lg mr-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t('compose.small', lang)}</SelectItem>
              <SelectItem value="3">{t('compose.normal', lang)}</SelectItem>
              <SelectItem value="5">{t('compose.large', lang)}</SelectItem>
              <SelectItem value="7">{t('compose.huge', lang)}</SelectItem>
            </SelectContent>
          </Select>
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
              <div className="absolute left-0 bottom-full mb-2 w-52 rounded-2xl shadow-2xl overflow-hidden z-[60]" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                <div className="p-2 flex flex-col gap-0.5">
                  <span className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--zinc-500))' }}>{lang === 'ru' ? 'Вставить код' : 'Insert Code'}</span>
                  <button
                    onClick={() => insertCodeElement('inline')}
                    className="flex items-center gap-2.5 text-left px-3 py-2.5 text-sm rounded-xl transition-colors" style={{ color: 'hsl(var(--foreground))' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'hsl(var(--zinc-200))'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Braces className="w-4 h-4" style={{ color: 'hsl(var(--zinc-500))' }} />
                    <div>
                      <div className="font-medium">Inline code</div>
                      <div className="text-[11px]" style={{ color: 'hsl(var(--zinc-500))' }}>{lang === 'ru' ? 'Код внутри строки' : 'Code within text'}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => insertCodeElement('block')}
                    className="flex items-center gap-2.5 text-left px-3 py-2.5 text-sm rounded-xl transition-colors" style={{ color: 'hsl(var(--foreground))' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'hsl(var(--zinc-200))'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Code className="w-4 h-4" style={{ color: 'hsl(var(--zinc-500))' }} />
                    <div>
                      <div className="font-medium">Code block</div>
                      <div className="text-[11px]" style={{ color: 'hsl(var(--zinc-500))' }}>{lang === 'ru' ? 'Многострочный код' : 'Multi-line code'}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => insertCodeElement('log')}
                    className="flex items-center gap-2.5 text-left px-3 py-2.5 text-sm rounded-xl transition-colors" style={{ color: 'hsl(var(--foreground))' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'hsl(var(--zinc-200))'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Terminal className="w-4 h-4" style={{ color: 'hsl(var(--zinc-500))' }} />
                    <div>
                      <div className="font-medium">{lang === 'ru' ? 'Лог / Терминал' : 'Log / Terminal'}</div>
                      <div className="text-[11px]" style={{ color: 'hsl(var(--zinc-500))' }}>{lang === 'ru' ? 'Логи, конфиги, вывод' : 'Logs, configs, output'}</div>
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
              <div className="absolute right-0 bottom-full mb-2 w-56 rounded-2xl shadow-2xl overflow-hidden z-[60]" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                <div className="p-2 flex flex-col gap-0.5">
                  <button onClick={() => handleAiAction('spellcheck')} className="text-left px-4 py-2.5 text-sm font-medium text-white bg-[#1CA88E] rounded-xl transition-colors hover:bg-[#179b82]">{t('compose.proofread', lang)}</button>
                  <button onClick={() => handleAiAction('professional')} className="text-left px-4 py-2.5 text-sm rounded-xl transition-colors" style={{ color: 'hsl(var(--foreground))' }} onMouseEnter={e => { e.currentTarget.style.background = 'hsl(var(--zinc-200))'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>{t('compose.makeProfessional', lang)}</button>
                  <button onClick={() => handleAiAction('friendly')} className="text-left px-4 py-2.5 text-sm rounded-xl transition-colors" style={{ color: 'hsl(var(--foreground))' }} onMouseEnter={e => { e.currentTarget.style.background = 'hsl(var(--zinc-200))'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>{t('compose.makeFriendly', lang)}</button>
                  <button onClick={() => handleAiAction('rewrite')} className="text-left px-4 py-2.5 text-sm rounded-xl transition-colors" style={{ color: 'hsl(var(--foreground))' }} onMouseEnter={e => { e.currentTarget.style.background = 'hsl(var(--zinc-200))'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>{t('compose.rewrite', lang)}</button>
                  <button onClick={() => handleAiAction('translate')} className="text-left px-4 py-2.5 text-sm rounded-xl transition-colors" style={{ color: 'hsl(var(--foreground))' }} onMouseEnter={e => { e.currentTarget.style.background = 'hsl(var(--zinc-200))'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>{t('compose.autoTranslate', lang)}</button>
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
            {/* Crypto sign/encrypt toggles (per-message) */}
            <button
              onClick={() => setSignThis(!signThis)}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-all",
                signThis
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-zinc-800/50 text-zinc-500 border-zinc-700/30 hover:text-zinc-300"
              )}
              title={lang === 'ru' ? (signThis ? 'Подпись включена' : 'Подпись выключена') : (signThis ? 'Signing enabled' : 'Signing disabled')}
            >
              <Shield className="w-3 h-3" />
              {settings.cryptoPreferredType === 'smime' ? 'S/MIME' : 'PGP'}
            </button>
            <button
              onClick={() => setEncryptThis(!encryptThis)}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-all",
                encryptThis
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-zinc-800/50 text-zinc-500 border-zinc-700/30 hover:text-zinc-300"
              )}
              title={lang === 'ru' ? (encryptThis ? 'Шифрование включено' : 'Шифрование выключено') : (encryptThis ? 'Encryption enabled' : 'Encryption disabled')}
            >
              <Lock className="w-3 h-3" />
              {lang === 'ru' ? 'Шифр.' : 'Enc.'}
            </button>
            {settings.signatures && settings.signatures.length > 0 && (
              <Select
                value={selectedSignatureId || '__none__'}
                onValueChange={(v) => setSelectedSignatureId(v === '__none__' ? undefined : v)}
              >
                <SelectTrigger className="w-auto h-8 px-2 text-xs gap-1 rounded-lg min-w-0 max-w-[140px]">
                  <SelectValue placeholder={t('compose.noSignature', lang)} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t('compose.noSignature', lang)}</SelectItem>
                  {settings.signatures.map(sig => (
                    <SelectItem key={sig.id} value={sig.id}>{sig.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
