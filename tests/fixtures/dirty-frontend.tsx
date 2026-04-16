// TEST FIXTURE — intentionally contains violations for /cleanup, /sweep, and /review
// See tests/EXPECTED.md for the full list of expected findings.

import React, { useState } from 'react';
import axios from 'axios'; // unused import

interface Props {
  items: any[]; // violation: any type
  userId: string;
}

export function ItemList({ items, userId }: Props) {
  const [selected, setSelected] = useState<any>(null); // violation: any type

  console.log('ItemList rendered', items); // violation: stray debug log

  const handleSelect = (id: string) => {
    setSelected(id as any); // violation: unsafe cast
  };

  return (
    // violation: hardcoded desktop width, not mobile-first
    <div style={{ width: '1200px', overflow: 'hidden' }}>
      {/* violation: no aria-label, no keyboard handler */}
      <button onClick={() => handleSelect('static')}>
        Click me
      </button>
      <ul>
        {items.map((item) => ( // violation: missing key prop
          // violation: onClick on li without role or keyboard support
          <li onClick={() => handleSelect(item.id)}>
            {item.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
