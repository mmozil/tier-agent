import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Boundary de tela: isola o crash de UMA página do resto da casca (sidebar + topbar).
 * Sem isso, um erro de render em qualquer página propaga até a raiz e o React 18
 * DESMONTA a árvore inteira — a topbar e o menu somem junto. Com o boundary, só a
 * área de conteúdo mostra o erro; o topo continua de pé. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] crash de tela:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="mt-2 flex flex-col items-start gap-3 rounded-[12px] border border-[#EDEDED] dark:border-[#23272e] bg-white dark:bg-[#14171c] p-6">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <h2 className="text-[15px] font-medium text-[#262626] dark:text-slate-200">Algo quebrou nesta tela</h2>
          </div>
          <p className="text-[13px] text-[#262626]/[0.56] dark:text-[#9aa1ab] max-w-[560px]">
            O resto do painel continua funcionando (o menu e os botões do topo seguem aí em cima).
            Recarregue a página ou abra outra tela. Se persistir, me mande este texto:
          </p>
          <pre className="text-[11px] text-[#262626]/[0.5] dark:text-[#8b93a0] bg-[#F7F7F8] dark:bg-[#1b1e24] rounded-[8px] p-3 max-w-full overflow-auto whitespace-pre-wrap">
            {String(error?.message || error)}
          </pre>
          <button
            onClick={this.reset}
            className="h-8 px-3 rounded-[10px] text-[13px] font-medium text-white bg-[#003083] hover:bg-[#002a73] transition-colors active:scale-[0.98]"
          >
            Tentar de novo
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
