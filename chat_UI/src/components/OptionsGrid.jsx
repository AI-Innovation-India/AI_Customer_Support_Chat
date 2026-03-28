import React from 'react';
import './OptionsGrid.css';
import { Snowflake, Flame, TriangleAlert, Wrench, FileText, Settings, MapPin, ShoppingCart } from 'lucide-react';

const options = [
  { id: 'cooling',  title: 'Cooling Issue',        icon: <Snowflake size={20} color="#5EDCFF" />,  value: 'Cooling Problem',         aiText: 'I am having a cooling issue. My unit is not cooling properly.' },
  { id: 'heating',  title: 'Heating Issue',         icon: <Flame size={20} color="#FF7DFF" />,      value: 'Heating Problem',         aiText: 'I am having a heating issue. My unit is not providing heat.' },
  { id: 'error',    title: 'Fault / Error Code',    icon: <TriangleAlert size={20} color="#FBBF24" />, value: 'Fault Code / Diagnostic', aiText: 'My unit is showing a fault code or error alarm that I need help diagnosing.' },
  { id: 'service',  title: 'Service & Maintenance', icon: <Wrench size={20} color="#D1D5DB" />,     value: 'Maintenance / Service',   aiText: 'I need help with service or maintenance for my unit.' },
  { id: 'warranty', title: 'Warranty Claim',        icon: <FileText size={20} color="#E5E7EB" />,   value: 'Warranty',                aiText: 'I need help with a warranty claim or warranty query.' },
  { id: 'parts',    title: 'Parts & Spares',        icon: <Settings size={20} color="#9CA3AF" />,   value: 'Parts & Spares',          aiText: 'I need help finding spare parts or replacement components.' },
  { id: 'dealer',   title: 'Find Dealer / Service', icon: <MapPin size={20} color="#EF4444" />,     value: 'Service Center / Dealer', aiText: 'I need to find a nearby authorized dealer or service center.' },
  { id: 'buy',      title: 'Buy / Get Quote',       icon: <ShoppingCart size={20} color="#60A5FA" />, value: 'Purchase Inquiry',      aiText: 'I am interested in purchasing a unit and would like pricing or a quote.' },
];

const OptionsGrid = ({ onOptionSelect }) => (
  <div className="options-panel-container glass-panel">
    <h3 className="options-title">What can I help you with today?</h3>
    <div className="options-grid">
      {options.map(opt => (
        <button
          key={opt.id}
          className="option-card"
          onClick={() => onOptionSelect(opt)}
        >
          <div className="option-icon">{opt.icon}</div>
          <span className="option-text">{opt.title}</span>
        </button>
      ))}
    </div>
  </div>
);

export default OptionsGrid;
