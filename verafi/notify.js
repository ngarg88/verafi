/**
 * Notifications. Whichever channel you configure wins — all three are plain fetch,
 * no SDK. An agent that finds something at 3am is worthless if you never hear about it.
 */
/** Same rule as every other outbound call: it must not be able to hang us. */
async function post(url, opts, ms = 8000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); }
  finally { clearTimeout(t); }
}
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

export async function notify({ title, lines, url }) {
  const body = [title, '', ...lines].join('\n');

  // ntfy.sh — zero signup, install the app, pick an unguessable topic name
  if (process.env.NTFY_TOPIC) {
    await post(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
      method: 'POST', headers: { Title: title, Priority: 'default', ...(url ? { Click: url } : {}) },
      body: lines.join('\n')
    });
    return 'ntfy';
  }

  // Telegram — message @BotFather, then message your bot once to get the chat id
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    await post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: body })
    });
    return 'telegram';
  }

  // Resend — free tier is 100 emails/day, plenty for one person
  if (process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL) {
    await post('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.RESEND_FROM ?? 'Verafi <onboarding@resend.dev>',
        to: [process.env.NOTIFY_EMAIL], subject: title,
        html: `<div style="font:15px/1.6 -apple-system,sans-serif;color:#151913">
                 <h2 style="font-family:Georgia,serif;font-weight:500">${html(title)}</h2>
                 <ul>${lines.map(l => `<li>${html(l)}</li>`).join('')}</ul>
                 ${url ? `<p><a href="${html(url)}">Open Verafi</a></p>` : ''}</div>` })
    });
    return 'email';
  }
  return null;
}
