/**
 * Notifications. Whichever channel you configure wins — all three are plain fetch,
 * no SDK. An agent that finds something at 3am is worthless if you never hear about it.
 */
export async function notify({ title, lines, url }) {
  const body = [title, '', ...lines].join('\n');

  // ntfy.sh — zero signup, install the app, pick an unguessable topic name
  if (process.env.NTFY_TOPIC) {
    await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
      method: 'POST', headers: { Title: title, Priority: 'default', ...(url ? { Click: url } : {}) },
      body: lines.join('\n')
    });
    return 'ntfy';
  }

  // Telegram — message @BotFather, then message your bot once to get the chat id
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: body, parse_mode: 'HTML' })
    });
    return 'telegram';
  }

  // Resend — free tier is 100 emails/day, plenty for one person
  if (process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.RESEND_FROM ?? 'Verafi <onboarding@resend.dev>',
        to: [process.env.NOTIFY_EMAIL], subject: title,
        html: `<div style="font:15px/1.6 -apple-system,sans-serif;color:#151913">
                 <h2 style="font-family:Georgia,serif;font-weight:500">${title}</h2>
                 <ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>
                 ${url ? `<p><a href="${url}">Open Verafi</a></p>` : ''}</div>` })
    });
    return 'email';
  }
  return null;
}
