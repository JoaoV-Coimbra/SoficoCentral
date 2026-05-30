import React, { Component } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Tela de segurança para evitar página branca caso algum erro de runtime escape.
type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  error: string;
};

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: "" };
  }

  static getDerivedStateFromError(error: Error) {
    return { error: error?.message || "Erro inesperado ao carregar a aplicação." };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-fi-paper p-6">
          <div className="max-w-xl rounded-lg border border-violet-100 bg-white p-6 text-center shadow-glow">
            <img className="mx-auto mb-4 h-16 w-16 rounded-lg" src="/fi-logo.png" alt="Logo Sofico" />
            <h1 className="text-2xl font-black text-fi-navy">Erro ao carregar</h1>
            <p className="mt-3 text-sm font-semibold text-slate-500">{this.state.error}</p>
            <button className="button-primary mt-5" type="button" onClick={() => window.location.reload()}>
              Recarregar
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Ponto de entrada React usado pelo Vite em desenvolvimento e produção.
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
