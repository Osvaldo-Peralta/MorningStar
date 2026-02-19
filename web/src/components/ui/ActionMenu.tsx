import React, { useState, useRef, useEffect } from "react";

export interface ActionItem{
    label: string
    icon: React.ReactNode
    onClick: () => void
    variant?: 'default' | 'danger'
}

interface ActionMenuProps {
    actions: ActionItem[];
}

export const ActionMenu = ({ actions }: ActionMenuProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null)

    // Cerrar el menu si se hace click fuera de el (Clean UX)
    useEffect(() =>{
        const handleClickOutside = (event: MouseEvent) => {
            if(menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        };
        
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, []);

    return (
        <div className="relative" ref={menuRef}>
            {/* Boton trigger: Los 3 puntos verticales clasicos */}
            <button onClick={(e) => {
                e.stopPropagation();
                setIsOpen(!isOpen);
            }}
            className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/70 hover:text-white">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
                </svg>
            </button>

            {/* Menu desplegable con Glassmorphism */}
            {isOpen && (
                <div className="absolute right-0 mt-2 w-48 py-2 z-50 rounded-2xl border border-white/10 bg-zinc-900/80 backdrop-blur-xl shadow-2xl animate-in fade-in zoom-in duration-300">
                    {actions.map((action, index) => (
                        <button
                            key={index}
                            onClick={(e) => {
                                e.stopPropagation();
                                action.onClick();
                                setIsOpen(false);
                            }}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                                ${action.variant === 'danger'
                                ? 'text-red-400 hover:bg-red-500/10'
                                : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                                }
                                `}
                        >
                            <span className="opacity-70"> {action.icon} </span>
                            {action.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};