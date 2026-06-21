import '@testing-library/jest-dom';

window.HTMLElement.prototype.scrollIntoView = function() {};

global.fetch = jest.fn().mockImplementation(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve([]),
  })
);

