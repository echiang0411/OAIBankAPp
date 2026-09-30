import type { Language, Verdict } from './schema.ts';
export const copy = {
  en: {
    scam: 'This looks like a scam', likely_scam: 'This may be a scam', unclear: 'Let’s check this with a person', likely_legitimate: 'This looks legitimate',
    safeAction: 'Do not use links or phone numbers in this message. Open the official app yourself, or contact the organization using a number you already trust.',
    legitimateAction: 'Open the bank or delivery service’s official app yourself to verify. A familiar domain alone does not prove who sent the message.',
    humanAction: 'We could not verify this message. Contact the bank through the app or the number on your card before taking action.',
    injectionFlag: 'This message contains instructions trying to change the checker’s answer.',
    domainFlag: 'At least one link is outside the configured domain allowlist.',
    shortenerFlag: 'A shortened link hides its destination and cannot be verified without opening it. We did not open it.',
    unreadable: 'The screenshot could not be read clearly enough to check. Please paste the message text or ask the bank for help.',
  },
  'zh-TW': {
    scam: '這看起來是詐騙', likely_scam: '這可能是詐騙', unclear: '請專人協助確認', likely_legitimate: '這看起來是正常訊息',
    safeAction: '請勿使用訊息中的連結或電話號碼。請自行開啟官方應用程式，或使用您原本信任的電話號碼聯絡該機構。',
    legitimateAction: '請自行開啟銀行或快遞公司的官方應用程式確認。熟悉的網域不代表寄件者身分已獲驗證。',
    humanAction: '我們無法確認這則訊息。採取行動前，請透過銀行應用程式或卡片上的電話號碼聯絡銀行。',
    injectionFlag: '訊息含有試圖改變檢查結果的指令。',
    domainFlag: '至少一個連結的網域不在設定的允許清單中。',
    shortenerFlag: '縮短連結隱藏了目的地，無法確認其安全性。我們沒有開啟連結。',
    unreadable: '無法清楚讀取截圖。請貼上訊息文字，或請銀行協助。',
  },
  'zh-CN': {
    scam: '这看起来是诈骗', likely_scam: '这可能是诈骗', unclear: '请专人协助确认', likely_legitimate: '这看起来是正常消息',
    safeAction: '请勿使用消息中的链接或电话号码。请自行打开官方应用，或使用您原本信任的电话号码联系该机构。',
    legitimateAction: '请自行打开银行或快递公司的官方应用确认。熟悉的域名不代表发件人身份已获验证。',
    humanAction: '我们无法确认这条消息。采取行动前，请通过银行应用或卡片上的电话号码联系银行。',
    injectionFlag: '消息含有试图改变检查结果的指令。',
    domainFlag: '至少一个链接的域名不在设置的允许列表中。',
    shortenerFlag: '短链接隐藏了目的地，无法确认其安全性。我们没有打开链接。',
    unreadable: '无法清楚读取截图。请粘贴消息文字，或请银行协助。',
  },
  "es": {
    "scam": "Esto parece una estafa",
    "likely_scam": "Esto podría ser una estafa",
    "unclear": "Pidamos ayuda a una persona",
    "likely_legitimate": "Esto parece legítimo",
    "safeAction": "No uses los enlaces ni los números de teléfono de este mensaje. Abre la aplicación oficial o contacta con la organización usando un número de confianza.",
    "legitimateAction": "Abre la aplicación oficial del banco o del servicio de reparto para verificarlo. Un dominio conocido no demuestra quién envió el mensaje.",
    "humanAction": "No pudimos verificar este mensaje. Antes de actuar, contacta con el banco desde la aplicación o llama al número de tu tarjeta.",
    "injectionFlag": "El mensaje contiene instrucciones que intentan cambiar el resultado de la revisión.",
    "domainFlag": "Al menos un enlace está fuera de la lista de dominios permitidos.",
    "shortenerFlag": "Un enlace acortado oculta su destino y no puede verificarse sin abrirlo. No lo abrimos.",
    "unreadable": "No pudimos leer la captura con suficiente claridad. Pega el texto del mensaje o pide ayuda al banco."
},
  "ar": {
    "scam": "تبدو هذه رسالة احتيال",
    "likely_scam": "قد تكون هذه رسالة احتيال",
    "unclear": "لنطلب المساعدة من أحد المختصين",
    "likely_legitimate": "تبدو هذه الرسالة سليمة",
    "safeAction": "لا تستخدم الروابط أو أرقام الهاتف في هذه الرسالة. افتح التطبيق الرسمي بنفسك أو اتصل بالجهة باستخدام رقم تثق به مسبقاً.",
    "legitimateAction": "افتح التطبيق الرسمي للبنك أو شركة التوصيل بنفسك للتحقق. اسم النطاق المألوف وحده لا يثبت هوية المرسل.",
    "humanAction": "لم نتمكن من التحقق من هذه الرسالة. تواصل مع البنك عبر التطبيق أو الرقم الموجود على بطاقتك قبل اتخاذ أي إجراء.",
    "injectionFlag": "تحتوي الرسالة على تعليمات تحاول تغيير نتيجة الفحص.",
    "domainFlag": "يوجد رابط واحد على الأقل خارج قائمة النطاقات المسموح بها.",
    "shortenerFlag": "الرابط المختصر يخفي وجهته ولا يمكن التحقق منه دون فتحه. لم نفتحه.",
    "unreadable": "تعذر قراءة لقطة الشاشة بوضوح كافٍ. الصق نص الرسالة أو اطلب المساعدة من البنك."
},
} satisfies Record<Language, Record<string, string>>;
export function actionFor(verdict: Verdict, language: Language): string {
  return verdict === 'likely_legitimate' ? copy[language].legitimateAction : verdict === 'unclear' ? copy[language].humanAction : copy[language].safeAction;
}
