export default function StatusPage() {
  return (
    <main
      style={{
        maxWidth: 560,
        margin: "80px auto",
        padding: "0 24px",
        lineHeight: 1.5,
      }}
    >
      <h1>TG Helper</h1>
      <p>Личный Telegram-ассистент для заметок и напоминаний.</p>
      <p>
        Статус: <strong>работает</strong>.
      </p>
      <p>Основной интерфейс — Telegram. Откройте бота и отправьте /start.</p>
    </main>
  );
}
