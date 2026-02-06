import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Search, LayoutGrid, Library, LogOut, Settings, ChevronDown, X } from 'lucide-react'; // Changed Bookmark -> Library

export default function Navbar() {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  
  const profileRef = useRef(null);
  const inputRef = useRef(null); 
  const [searchQuery, setSearchQuery] = useState('');

  const showSearch = location.pathname === '/' || location.pathname === '/saved';

  // --- SYNC URL <-> INPUT ---
  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';
    if (location.pathname === '/' && urlQuery !== searchQuery) {
       setSearchQuery(urlQuery);
    }
  }, [location.pathname, searchParams]);

  useEffect(() => {
    const currentUrlQuery = searchParams.get('q') || '';
    if (searchQuery === currentUrlQuery) return;
    if (location.pathname !== '/' && document.activeElement !== inputRef.current) return;

    const delayDebounceFn = setTimeout(() => {
      if (searchQuery.trim()) {
        navigate(`/?q=${searchQuery}`);
      } else if (location.pathname === '/' && currentUrlQuery) {
        navigate('/');
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, navigate, location.pathname, searchParams]);

  // --- HANDLERS ---
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      navigate(`/?q=${searchQuery}`);
      inputRef.current?.blur();
      setIsSearchOpen(false);
    }
    if (e.key === 'Escape') {
      setIsSearchOpen(false);
      setIsProfileOpen(false);
      inputRef.current?.blur();
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    if (location.pathname === '/' && searchParams.get('q')) navigate('/');
    setIsSearchOpen(false); 
  };

  const handleLogout = async () => {
    await logout();
    setIsProfileOpen(false);
    navigate('/login');
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isActive = (route) => {
    if (route === '/') return location.pathname === '/';
    return location.pathname.startsWith(route);
  };

  // --- STILI BOTTONI ---
  // Modificato padding e font size per far stare il testo su mobile
  const navBtnBase = "inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-all duration-200 h-9 px-2 sm:px-4 py-2 text-xs sm:text-sm focus:outline-none active:scale-95";
  
  const getBtnClass = (route) => isActive(route) 
    ? "bg-zinc-800 text-white shadow-sm ring-1 ring-white/10" 
    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-white"; 

  const glassStyle = "bg-zinc-900/80 backdrop-blur-xl border border-white/10 shadow-lg shadow-black/30";

  return (
    <>
      <div className="fixed top-2 sm:top-4 left-0 right-0 z-50 flex flex-col items-center px-2 sm:px-4 pointer-events-none">

        {/* --- NAVBAR --- */}
        <nav 
          className="relative pointer-events-auto flex w-full max-w-7xl items-center justify-between gap-1 sm:gap-2 rounded-3xl border border-zinc-800 bg-zinc-950/95 backdrop-blur p-2 shadow-2xl z-20"
        >

          {/* LOGO */}
          <Link 
            to="/" 
            className="ml-1 sm:ml-2 mr-1 flex-shrink-0 group flex items-center gap-2 focus:outline-none rounded-lg p-1 active:scale-95 transition-transform" 
            onClick={() => setSearchQuery('')}
          >
            <div className="flex items-center tracking-tighter text-sm md:text-xl select-none">
              <span className="font-bold text-white mr-1">FRANZ</span>
              <div className="bg-[var(--primary-color)] text-white font-bold px-1.5 py-0.5 rounded-[6px] shadow-lg shadow-[var(--primary-color)]/20 leading-none pb-1 pt-1">
                TUBE
              </div>
            </div>
          </Link>

          {/* SEARCH DESKTOP */}
          {showSearch ? (
            <div className="hidden md:flex flex-1 max-w-xl mx-auto px-4 relative">
              <div className="relative w-full group">
                <Search className="absolute left-4 top-3 h-5 w-5 text-zinc-500 group-focus-within:text-[var(--primary-color)] transition-colors" />
                <input
                  ref={inputRef} 
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Cerca video..."
                  className="w-full h-11 rounded-full border border-zinc-800 bg-zinc-900 px-4 pl-12 pr-10 text-sm text-zinc-100 focus:outline-none focus:bg-zinc-950 focus:border-[var(--primary-color)] focus:ring-1 focus:ring-[var(--primary-color)] transition-all placeholder:text-zinc-600"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-3 top-3 text-zinc-500 hover:text-white transition-colors focus:outline-none">
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="hidden md:flex flex-1" />
          )}

          {/* MENU AZIONI */}
          <div className="flex items-center gap-1 sm:gap-1 flex-shrink-0">
            
            {/* CATEGORIE (Testo visibile) */}
            <Link to="/categories" className={`${navBtnBase} ${getBtnClass('/categories')}`}>
              <LayoutGrid className="mr-1.5 sm:mr-2 h-4 w-4" /> 
              <span>Categorie</span>
            </Link>
            
            {/* LIBRERIA (Testo visibile, ex Salvati) */}
            {user && (
              <Link to="/saved" className={`${navBtnBase} ${getBtnClass('/saved')}`}>
                <Library className="mr-1.5 sm:mr-2 h-4 w-4" /> 
                <span>Libreria</span>
              </Link>
            )}

            <div className="h-5 w-[1px] bg-zinc-800 mx-1 hidden sm:block"></div>
            
            {/* PROFILO UTENTE */}
            {user && (
              <div className="relative" ref={profileRef}>
                <button 
                  onClick={() => setIsProfileOpen(!isProfileOpen)} 
                  className={`flex items-center gap-2 px-1 sm:px-2 py-1.5 rounded-2xl transition-all duration-200 focus:outline-none ${isActive('/profile') ? 'bg-zinc-800 text-white ring-1 ring-white/10' : 'hover:bg-zinc-800/50 text-zinc-400 hover:text-white'}`}
                >
                  <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-zinc-800 overflow-hidden ring-2 ring-zinc-900 flex items-center justify-center">
                    {user?.avatar ? <img src={`${user.avatar}?t=${Date.now()}`} alt="" className="h-full w-full object-cover" /> : <span className="text-xs font-bold text-white">{user?.username?.substring(0, 2).toUpperCase()}</span>}
                  </div>
                  <span className={`hidden lg:inline text-sm font-semibold max-w-[100px] truncate ${isActive('/profile') ? 'text-white' : 'text-zinc-200'}`}>{user.username}</span>
                  <ChevronDown className={`hidden lg:block h-3 w-3 transition-transform duration-200 ${isProfileOpen ? 'rotate-180' : ''}`} />
                </button>

                {isProfileOpen && (
                  <div className="absolute right-0 top-15 w-48 origin-top-right rounded-xl border border-zinc-800 bg-zinc-950 p-1.5 shadow-xl ring-1 ring-white/5 animate-in fade-in zoom-in-95 duration-200 z-50">
                    <Link to="/profile" className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white" onClick={() => setIsProfileOpen(false)}>
                        <Settings className="mr-2 h-4 w-4" /> Impostazioni
                    </Link>
                    <button className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-red-500 hover:bg-red-950/30 hover:text-red-400 transition-colors" onClick={handleLogout}>
                        <LogOut className="mr-2 h-4 w-4" /> Esci
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </nav>

        {/* --- MOBILE SEARCH BAR (Separata per non affollare la navbar) --- */}
        {showSearch && (
          <div className="md:hidden w-full max-w-md mt-4 relative z-10 pointer-events-auto flex items-center justify-center gap-3">
            <div 
              onClick={() => !isSearchOpen && setIsSearchOpen(true)}
              className={`
                  ${glassStyle} flex items-center overflow-hidden transition-all duration-500 cubic-bezier(0.32, 0.72, 0, 1)
                  ${isSearchOpen ? 'flex-1 h-12 rounded-2xl px-3 justify-start' : 'w-32 h-12 rounded-full justify-center cursor-pointer active:scale-95'}
              `}
            >
              <Search className="h-5 w-5 text-zinc-400 flex-shrink-0" />
              
              <span className={`font-medium text-zinc-300 text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${isSearchOpen ? 'w-0 opacity-0 ml-0' : 'w-auto opacity-100 ml-2'}`}>
                  Cerca
              </span>

              <input 
                  ref={inputRef} 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Cerca..." 
                  className={`bg-transparent border-none text-white placeholder:text-zinc-500 focus:ring-0 text-base h-full focus:outline-none transition-all duration-300 ${isSearchOpen ? 'flex-1 opacity-100 ml-3 pointer-events-auto' : 'w-0 opacity-0 ml-0 pointer-events-none'}`}
              />
              
              {isSearchOpen && searchQuery && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); setSearchQuery(''); inputRef.current.focus(); }} 
                    className="p-1 text-zinc-500 hover:text-white flex-shrink-0"
                  >
                      <X className="h-4 w-4 bg-zinc-800 rounded-full p-0.5" />
                  </button>
              )}
            </div>

            <div className={`transition-all duration-500 cubic-bezier(0.32, 0.72, 0, 1) overflow-hidden ${isSearchOpen ? 'w-12 opacity-100 scale-100' : 'w-0 opacity-0 scale-0'}`}>
               <button onClick={handleClearSearch} className={`${glassStyle} h-12 w-12 rounded-full flex items-center justify-center text-zinc-300 hover:text-white active:scale-90`}>
                  <X className="h-6 w-6" />
               </button>
            </div>
          </div>
        )}

      </div>
    </>
  );
}