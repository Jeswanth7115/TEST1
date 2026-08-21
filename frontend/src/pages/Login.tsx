import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../api/services';

interface LoginProps {
  onLoginSuccess?: (token: string) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const isAdminPortal = import.meta.env.VITE_PORTAL === 'admin';
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [adminAccess, setAdminAccess] = useState(isAdminPortal);
  const [adminPasskey, setAdminPasskey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      let resToken = '';
      if (isLogin) {
        const response = await authService.login(email, password);
        if (adminAccess && !['ADMIN', 'SUPER_ADMIN'].includes(response.user?.role)) {
          throw new Error('This account does not have administrator access.');
        }
        const { token } = response;
        resToken = token;
      } else {
        const { token } = adminAccess
          ? await authService.adminSignup(email, password, name, adminPasskey)
          : await authService.signup(email, password, name);
        resToken = token;
      }
      if (onLoginSuccess) {
        onLoginSuccess(resToken);
      } else {
        localStorage.setItem('token', resToken);
      }
      navigate(isAdminPortal ? '/workers' : '/projects');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || 'Authentication failed');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-white p-10 shadow-xl ring-1 ring-slate-900/5">
        <div>
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-sky-700">Dispatch operations</p>
          <h2 className="mt-3 text-center text-3xl font-bold tracking-tight text-slate-900">
            {adminAccess ? 'Administrator access' : isLogin ? 'Sign in to your account' : 'Create a new account'}
          </h2>
          <p className="mt-2 text-center text-sm text-slate-500">{adminAccess ? 'Manage worker nodes and resolve operational tickets.' : 'Reliable job execution for every team.'}</p>
          {adminAccess && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-500">Administrator registration requires the private passkey configured in the backend environment.</p>}
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="-space-y-px rounded-md shadow-sm">
            {!isLogin && (
              <div>
                <label htmlFor="name" className="sr-only">Name</label>
                <input
                  id="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="relative block w-full rounded-t-md border-0 py-1.5 px-3 text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                  placeholder="Full Name"
                />
              </div>
            )}
            {!isLogin && adminAccess && (
              <div>
                <label htmlFor="admin-passkey" className="sr-only">Administrator registration passkey</label>
                <input id="admin-passkey" type="password" required value={adminPasskey} onChange={(event) => setAdminPasskey(event.target.value)} className="relative block w-full border-0 px-3 py-2 text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-amber-600 sm:text-sm" placeholder="Administrator registration passkey" />
              </div>
            )}
            <div>
              <label htmlFor="email-address" className="sr-only">Email address</label>
              <input
                id="email-address"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`relative block w-full border-0 py-1.5 px-3 text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 ${isLogin ? 'rounded-t-md' : ''}`}
                placeholder="Email address"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="relative block w-full rounded-b-md border-0 py-1.5 px-3 text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                placeholder="Password"
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md">
              {error}
            </div>
          )}

          <div>
            <button
              type="submit"
              className="flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 shadow-sm"
            >
              {isLogin ? 'Sign in' : adminAccess ? 'Register administrator' : 'Sign up'}
            </button>
          </div>
        </form>

        <div className="text-center text-sm">
          {!adminAccess && <button onClick={() => setIsLogin(!isLogin)} className="font-medium text-blue-600 hover:text-blue-500">
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>}
          {adminAccess && <button type="button" onClick={() => { setIsLogin((value) => !value); setError(''); }} className="font-medium text-amber-700 hover:text-amber-600">
            {isLogin ? 'Register a new administrator' : 'Back to administrator sign in'}
          </button>}
          {!isAdminPortal && <button type="button" onClick={() => { setAdminAccess((value) => !value); setIsLogin(true); setError(''); }} className="mt-3 block w-full text-xs font-semibold text-slate-500 hover:text-sky-700">
              {adminAccess ? 'Back to workspace sign in' : 'Administrator sign in'}
            </button>}
        </div>
      </div>
    </div>
  );
}
