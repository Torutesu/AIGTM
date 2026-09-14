export default function RootNotFound() {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f7f6f5",
          color: "#474445",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <p style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: "0.14em" }}>
            404
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#004225" }}>
            Page not found
          </h1>
          <a
            href="/en/inbox"
            style={{
              display: "inline-block",
              marginTop: 16,
              padding: "10px 20px",
              borderRadius: 8,
              background: "#004225",
              color: "#fff",
              fontFamily: "monospace",
              fontSize: 11,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              textDecoration: "none",
            }}
          >
            Back to inbox
          </a>
        </div>
      </body>
    </html>
  );
}
