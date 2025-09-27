// snowflake.js — temporary resource matcher.
// Later replace internals with real Snowflake queries but KEEP the signature.

const CATALOG = {
  ON: {
    latch: [
      { name: 'Public Health Nurse (Waterloo)', phone: '519-575-4400', url: 'https://www.regionofwaterloo.ca' },
      { name: 'PSI Helpline', phone: '1-800-944-4773', url: 'https://postpartum.net' }
    ],
    bleeding: [
      { name: 'Ontario Telehealth', phone: '1-866-797-0000', url: 'https://www.ontario.ca/page/get-medical-advice-telehealth-ontario' },
      { name: 'Grand River Hospital', phone: '519-749-4300', url: 'https://www.grhosp.on.ca' }
    ],
    mood: [
      { name: 'PSI Helpline (24/7 text “HELP” to 800-944-4773)', phone: '1-800-944-4773', url: 'https://postpartum.net' },
      { name: 'Here 24/7 (Waterloo Region)', phone: '1-844-437-3247', url: 'https://here247.ca' }
    ],
    general: [
      { name: 'Postpartum Support Intl', phone: '1-800-944-4773', url: 'https://postpartum.net' }
    ],
    pain: [
      { name: 'Ontario Telehealth Nurse', phone: '1-866-797-0000', url: 'https://www.ontario.ca/page/get-medical-advice-telehealth-ontario' }
    ],
    sleep: [
      { name: 'Public Health Nurse (Waterloo)', phone: '519-575-4400', url: 'https://www.regionofwaterloo.ca' }
    ]
  }
};

async function lookupResources({ topic, region }) {
  const reg = CATALOG[region] ? region : 'ON';
  const list = CATALOG[reg][topic] || CATALOG[reg].general || [];
  // return at most 2
  return list.slice(0, 2);
}

module.exports = { lookupResources };
