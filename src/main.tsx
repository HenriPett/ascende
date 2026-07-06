import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initTheme } from "@/hooks/useTheme";

// Aplica o tema salvo (claro/escuro/sistema) antes do primeiro render — evita "flash".
initTheme();

createRoot(document.getElementById("root")!).render(<App />);