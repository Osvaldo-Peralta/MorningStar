// web/src/components/ui/Modal.tsx
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title: string;
}

export const Modal = ({ isOpen, onClose, children, title }: ModalProps) => {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-100 flex items-center justify-center p-6">
      {/* Liquid Backdrop: Oscurece ligeramente y difumina masivamente */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur animate-in fade-in duration-100" 
        onClick={onClose} 
      />
      
      {/* Modal Container: El "Cristal Líquido" */}
      <div className="
        relative w-full max-w-sm 
        bg-white/3 backdrop-blur-3xl
        rounded-[2.5rem] p-10
        border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)]
        animate-reveal ring-1 ring-white/5
      ">
        {/* Indicador superior estilo iOS (opcional pero suma al look) */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-white/10 rounded-full" />
        
        <h2 className="mb-8 text-2xl font-semibold text-center tracking-tight text-white/90">
          {title}
        </h2>
        
        <div className="relative z-10">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};