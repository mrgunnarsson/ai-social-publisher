"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setLoading(true);
    setMessage("");

    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    window.location.href = "/";
  }

  return (
    <main
      style={{
        maxWidth: 420,
        margin: "80px auto",
        padding: 24,
      }}
    >
      <h1>AI Social Publisher</h1>

      <h2>Logga in</h2>

      <form
        onSubmit={handleLogin}
        style={{
          display: "grid",
          gap: 16,
          marginTop: 24,
        }}
      >
        <input
          type="email"
          placeholder="E-post"
          value={email}
          onChange={(event) =>
            setEmail(event.target.value)
          }
          required
        />

        <input
          type="password"
          placeholder="Lösenord"
          value={password}
          onChange={(event) =>
            setPassword(event.target.value)
          }
          required
        />

        <button
          type="submit"
          disabled={loading}
        >
          {loading
            ? "Loggar in..."
            : "Logga in"}
        </button>
      </form>

      {message && (
        <p style={{ marginTop: 20 }}>
          {message}
        </p>
      )}
    </main>
  );
}