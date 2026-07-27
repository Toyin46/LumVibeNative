if (typeof global.DOMException === 'undefined') {
    global.DOMException = class DOMException extends Error {
      constructor(message, name) {
        super(message);
        this.name = name || 'Error';
      }
    };
  } 