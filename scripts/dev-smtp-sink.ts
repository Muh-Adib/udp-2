/**
 * Dev-only SMTP sink utk QA ronde 21: menerima koneksi SMTP di 127.0.0.1:3465,
 * menerima AUTH apa pun, mencetak isi DATA, membalas 250. Bukan bagian dari app.
 */
import net from "node:net";

const b64 = (s: string) => Buffer.from(s).toString("base64");

const server = net.createServer((socket) => {
  let inData = false;
  let dataBuf = "";
  let authStage = 0; // 0=idle 1=tunggu user 2=tunggu pass

  socket.write("220 dev-smtp-sink ESMTP ready\r\n");

  socket.on("data", (buf) => {
    const text = buf.toString();
    for (const line of text.split("\r\n")) {
      if (line === "") continue;

      if (authStage === 1) {
        console.log("[SINK] AUTH user:", Buffer.from(line, "base64").toString());
        authStage = 2;
        socket.write(`334 ${b64("Password:")}\r\n`);
        continue;
      }
      if (authStage === 2) {
        console.log("[SINK] AUTH pass: (diterima)");
        authStage = 0;
        socket.write("235 2.7.0 Authentication successful\r\n");
        continue;
      }

      if (inData) {
        if (line === ".") {
          inData = false;
          console.log("[SINK] === DATA diterima ===\n" + dataBuf.slice(0, 600) + "\n========================");
          dataBuf = "";
          socket.write("250 2.0.0 OK queued as SINK-001\r\n");
        } else {
          dataBuf += line + "\r\n";
        }
        continue;
      }

      const cmd = line.trim().toUpperCase();
      if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) {
        socket.write("250-dev-smtp-sink\r\n250-SIZE 10485760\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n");
      } else if (cmd.startsWith("AUTH PLAIN")) {
        socket.write("235 2.7.0 Authentication successful\r\n");
      } else if (cmd === "AUTH LOGIN" || cmd.startsWith("AUTH LOGIN")) {
        authStage = 1;
        socket.write(`334 ${b64("Username:")}\r\n`);
      } else if (cmd.startsWith("MAIL FROM") || cmd.startsWith("RCPT TO")) {
        console.log("[SINK]", line);
        socket.write("250 2.1.0 OK\r\n");
      } else if (cmd === "DATA") {
        inData = true;
        dataBuf = "";
        socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
      } else if (cmd.startsWith("QUIT")) {
        socket.write("221 2.0.0 Bye\r\n");
        socket.end();
      } else if (cmd.startsWith("STARTTLS")) {
        socket.write("454 TLS not available\r\n");
      } else {
        socket.write("250 2.0.0 OK\r\n");
      }
    }
  });

  socket.on("error", () => {});
});

server.listen(3465, "127.0.0.1", () => console.log("[SINK] dev SMTP sink listening on 127.0.0.1:3465"));
