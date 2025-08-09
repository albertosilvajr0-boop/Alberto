document.getElementById("send").addEventListener("click", async () => {
  const prompt = document.getElementById("prompt").value.trim();
  const box = document.getElementById("responses");
  if (!prompt) { box.innerHTML = "Type something first."; return; }
  box.innerHTML = "Loading...";
  try {
    const res = await fetch("/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    box.innerHTML = `<h3>OpenAI:</h3><pre>${data.openai}</pre>`;
  } catch (e) {
    box.innerHTML = `Error: ${e.message}`;
  }
});
