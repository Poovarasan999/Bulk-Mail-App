import { useCallback, useMemo, useState } from "react";

const initialForm = {
  subject: "",
  body: "",
  recipients: "",
};

const parseRecipients = (input) =>
  input
    .split(/[,\n;]/)
    .map((value) => value.trim())
    .filter(Boolean);

const apiBase = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const api = (path) => `${apiBase}${path}`;

function App() {
  const [form, setForm] = useState(initialForm);
  const [history, setHistory] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [deletingId, setDeletingId] = useState(null);

  const recipientCount = useMemo(
    () => parseRecipients(form.recipients).length,
    [form.recipients]
  );

  const fetchHistory = useCallback(async () => {
    try {
      const response = await fetch(api("/api/mail/history"));
      if (!response.ok) {
        throw new Error("Unable to fetch email history.");
      }
      const data = await response.json();
      setHistory(data);
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  const onChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setStatus({ type: "", message: "" });

    const recipients = parseRecipients(form.recipients);
    if (!form.subject.trim() || !form.body.trim() || recipients.length === 0) {
      setStatus({
        type: "error",
        message: "Subject, body, and at least one recipient are required.",
      });
      return;
    }

    setIsSending(true);
    const sendTimeoutMs = 90_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), sendTimeoutMs);

    let response;
    let data;
    let networkError;
    try {
      response = await fetch(api("/api/mail/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: form.subject,
          body: form.body,
          recipients,
        }),
        signal: controller.signal,
      });
      data = await response.json().catch(() => ({}));
    } catch (err) {
      networkError = err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (networkError) {
      const msg =
        networkError.name === "AbortError"
          ? `Request timed out after ${sendTimeoutMs / 1000}s. Check backend is running and SMTP is reachable.`
          : networkError.message || "Network error while contacting backend.";
      setStatus({ type: "error", message: msg });
    } else if (!response.ok) {
      const parts = [data.message, data.error].filter(Boolean);
      setStatus({
        type: "error",
        message: parts.join(" ") || "Failed to send email.",
      });
    } else {
      setStatus({ type: "success", message: data.message });
      setForm(initialForm);
      setIsLoadingHistory(true);
      fetchHistory();
    }

    setIsSending(false);
  };

  const removeHistoryItem = async (id) => {
    setDeletingId(id);
    setStatus({ type: "", message: "" });
    try {
      const response = await fetch(api(`/api/mail/history/${id}`), {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Could not remove this entry.");
      }
      setHistory((prev) => prev.filter((item) => item._id !== id));
      setStatus({ type: "success", message: data.message || "Removed from history." });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-5xl gap-5 bg-slate-100 p-4 text-slate-800 sm:p-6">
      <section className="rounded-xl bg-white p-5 shadow-lg shadow-slate-900/5">
        <h1 className="text-2xl font-bold sm:text-3xl">Bulk Mail Sender</h1>
        <p className="mt-1 text-sm text-slate-600 sm:text-base">
          Compose one message and send it to multiple recipients at once.
        </p>

        <form onSubmit={onSubmit} className="mt-4 grid gap-3">
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            Subject
            <input
              name="subject"
              value={form.subject}
              onChange={onChange}
              placeholder="Weekly update"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            Email Body
            <textarea
              name="body"
              rows={7}
              value={form.body}
              onChange={onChange}
              placeholder="Write your message..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            Recipient Emails (comma, semicolon, or new line separated)
            <textarea
              name="recipients"
              rows={5}
              value={form.recipients}
              onChange={onChange}
              placeholder="alice@example.com, bob@example.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
          </label>

          <div className="flex items-center justify-between gap-3">
            <small className="text-xs text-slate-500 sm:text-sm">
              {recipientCount} recipient(s) detected
            </small>
            <button
              type="submit"
              disabled={isSending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isSending ? "Sending..." : "Send Bulk Mail"}
            </button>
          </div>
        </form>

        {status.message && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-sm ${
              status.type === "success"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {status.message}
          </p>
        )}
      </section>

      <section className="rounded-xl bg-white p-5 shadow-lg shadow-slate-900/5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Email History</h2>
          <button
            type="button"
            onClick={() => {
              setIsLoadingHistory(true);
              fetchHistory();
            }}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-900"
          >
            Refresh
          </button>
        </div>
        {isLoadingHistory ? (
          <p className="text-sm text-slate-600">Loading history...</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-slate-600">
            No history loaded yet. Click refresh to fetch records.
          </p>
        ) : (
          <ul className="grid gap-2">
            {history.map((item) => (
              <li key={item._id} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <strong className="min-w-0 flex-1">{item.subject}</strong>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        item.status === "success"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {item.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeHistoryItem(item._id)}
                      disabled={deletingId === item._id}
                      className="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingId === item._id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                </div>
                <p className="text-sm text-slate-700">{item.body}</p>
                <small className="mt-1 block text-xs text-slate-500">
                  Recipients: {item.recipients.join(", ")}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;
