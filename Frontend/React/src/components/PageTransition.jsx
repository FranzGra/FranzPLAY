import React from 'react';
import { useLocation } from 'react-router-dom';

export default function PageTransition({ children }) {
  const location = useLocation();
  const path = location.pathname;

  const styles = `
    /* --- ANIMAZIONI STANDARD --- */
    @keyframes softZoomIn { 0% { opacity: 0; transform: scale(0.98) translateY(20px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
    @keyframes softZoomOut { 0% { opacity: 0; transform: scale(1.1) translateY(100px); } 100% { opacity: 1; transform: scale(1) translateY(0px); } }
    @keyframes softSlide { 0% { opacity: 0; transform: scale(0.95) translateY(15px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
    @keyframes softLift { 0% { opacity: 0; transform: translateY(30px); } 100% { opacity: 1; transform: translateY(0); } }
    @keyframes enterFromRight { 0% { opacity: 0; transform: translateX(50px); } 100% { opacity: 1; transform: translateX(0); } }

    /* Classi */
    .anim-player { animation: softZoomIn 0.8s cubic-bezier(0.25, 1, 0.5, 1) forwards; }
    .anim-home   { animation: softZoomOut 1s cubic-bezier(0.25, 1, 0.5, 1) forwards; }
    .anim-button { animation: softSlide 0.6s cubic-bezier(0.25, 1, 0.5, 1) forwards; }
    .slide-up    { animation: softLift 1.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
    .anim-slide-right { animation: enterFromRight 1s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
    .anim-default { animation: softSlide 0.6s ease-out forwards; }

    @media (prefers-reduced-motion: reduce) {
      .will-change-transform { animation: none !important; transform: none !important; transition: none !important; }
    }
  `;

  const getAnimationClass = () => {
    // FIX: Nessuna animazione di pagina per Auth, così lo sfondo resta fisso
    if (path === '/login' || path === '/register') return ''; 
    
    if (path.startsWith('/category/')) return 'anim-slide-right';
    if (path === '/categories') return 'anim-button';
    if (path.startsWith('/watch')) return 'anim-player';
    if (path === '/') return 'anim-home';
    if (path === '/saved') return 'anim-button';
    if (path === '/profile') return 'slide-up';
    return 'anim-default';
  };

  return (
    <>
      <style>{styles}</style>
      <div 
        key={path} 
        className={`w-full h-full overflow-hidden will-change-transform ${getAnimationClass()}`}
      >
        {children}
      </div>
    </>
  );
}