import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Users, List, Activity } from 'lucide-react';
import clsx from 'clsx';
import './BottomNav.css';

const navItems = [
  { name: 'Dashboard', path: '/', icon: Home },
  { name: 'Friends', path: '/friends', icon: Users },
  { name: 'Groups', path: '/groups', icon: List },
  { name: 'Activity', path: '/activity', icon: Activity },
];

export const BottomNav: React.FC = () => {
  return (
    <nav className="bottom-nav glass">
      <div className="bottom-nav-content">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) => clsx('nav-item', isActive && 'active')}
          >
            <item.icon size={24} />
            <span className="nav-label">{item.name}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
};
