// Colunas do Atendimento com largura ajustável (16/11/2026, CCDA): «assim como no Agent, permitir
// aumentar e diminuir essas colunas». Mesmo gesto do menu lateral do Agent (AdminLayout): arrastar
// a borda direita, a largura fica guardada neste navegador, duplo clique volta ao padrão.
import { useState } from "react";

function ler(chave: string, padrao: number, min: number, max: number): number {
  try {
    const v = parseInt(localStorage.getItem(chave) || "", 10);
    return Number.isNaN(v) ? padrao : Math.min(max, Math.max(min, v));
  } catch {
    return padrao;
  }
}

function gravar(chave: string, v: number) {
  try {
    localStorage.setItem(chave, String(v));
  } catch {
    /* navegador sem armazenamento: vale só nesta visita */
  }
}

/** Largura de uma coluna que se arrasta pela borda direita. */
export function useLarguraArrastavel(chave: string, padrao: number, min: number, max: number) {
  const [largura, setLargura] = useState(() => ler(chave, padrao, min, max));
  const [arrastando, setArrastando] = useState(false);

  function iniciar(e: { preventDefault: () => void; clientX: number }) {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = largura;
    setArrastando(true);
    let atual = w0;
    const mover = (ev: MouseEvent) => {
      atual = Math.min(max, Math.max(min, w0 + ev.clientX - x0));
      setLargura(atual);
    };
    const soltar = () => {
      document.removeEventListener("mousemove", mover);
      document.removeEventListener("mouseup", soltar);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setArrastando(false);
      gravar(chave, atual);
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", mover);
    document.addEventListener("mouseup", soltar);
  }

  function resetar() {
    setLargura(padrao);
    gravar(chave, padrao);
  }

  return { largura, arrastando, iniciar, resetar };
}

/** A faixa de 6 px na borda direita da coluna (que precisa ser `relative`). */
export function BordaArrastavel({
  iniciar,
  resetar,
}: {
  iniciar: (e: { preventDefault: () => void; clientX: number }) => void;
  resetar: () => void;
}) {
  return (
    <div
      onMouseDown={iniciar}
      onDoubleClick={resetar}
      title="Arraste para ajustar a largura (duplo clique volta ao padrão)"
      role="separator"
      aria-orientation="vertical"
      className="group absolute inset-y-0 -right-[3px] z-20 w-1.5 cursor-col-resize"
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-[#003083]/50 dark:group-hover:bg-[#5b9bff]/50" />
    </div>
  );
}
