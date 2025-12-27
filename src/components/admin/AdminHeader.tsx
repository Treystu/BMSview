import React from 'react';
import Logo from '../icons/Logo';

interface NetlifyUser {
  email: string;
  user_metadata: {
    full_name: string;
  };
}

interface AdminHeaderProps {
    user: NetlifyUser;
    onLogout: () => void;
}

const AdminHeader: React.FC<AdminHeaderProps> = ({ user, onLogout }) => {
    return (
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between space-y-4 sm:space-y-0 mb-8">
            <div className="flex items-center space-x-3">
                <Logo className="h-12 w-12" />
                <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
            </div>
             <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-400 truncate">
                    Welcome, {user.user_metadata?.full_name || user.email}
                </span>
                <button 
                    onClick={onLogout} 
                    className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md text-sm transition-colors"
                >
                    Log Out
                </button>
            </div>
        </header>
    );
};

export default AdminHeader;