const expect = require('chai').expect;
const denodeify = require('denodeify');
const request = denodeify(require('request'));
const AddonTestApp = require('ember-cli-addon-tests').AddonTestApp;
const fs = require('fs-extra');

const CSP_META_TAG_REG_EXP = /<meta http-equiv="Content-Security-Policy" content="(.*)">/i;

function getConfigPath(app) {
  return app.filePath('config/content-security-policy.js');
}

async function setConfig(app, config) {
  let file = getConfigPath(app);
  let content = `module.exports = function() { return ${JSON.stringify(config)}; }`;

  await fs.writeFile(file, content);
}

async function removeConfig(app) {
  let file = getConfigPath(app);

  if (!fs.existsSync(file)) {
    return;
  }

  await fs.remove(file);
}

describe('e2e: delivers CSP as configured', function() {
  this.timeout(300000);

  let app;

  before(async function() {
    app = new AddonTestApp();

    await app.create('default', { noFixtures: true });
  });

  afterEach(async function() {
    await removeConfig(app);
  });

  // Server isn't shutdown successfully if `app.startServer()` and `app.stopServer()`
  // are not wrapped inside a describe block. Therefore all tests after the first one
  // fail with a "Port 49741 is already in use" error.
  describe('', function() {
    beforeEach(async function() {
      await setConfig(app, {
        delivery: ['header', 'meta'],
        policy: {
          'font-src': ["'self'", "http://fonts.gstatic.com"],
        },
        reportOnly: false,
      });

      await app.startServer({
        // nonce is always added to CSP in HTTP Header but only
        // to CSP in meta element for testing environment
        additionalArguments: ['--environment', 'test']
      });
    });

    afterEach(async function() {
      await app.stopServer();
    });

    it('creates a CSP meta tag if `delivery` option includes `"meta"`', async function() {
      let response = await request({
        url: 'http://localhost:49741',
        headers: {
          'Accept': 'text/html'
        }
      });

      expect(response.body).to.match(CSP_META_TAG_REG_EXP);
    });

    it('delivers same policy by meta element as by HTTP header', async function() {
      let response = await request({
        url: 'http://localhost:49741',
        headers: {
          'Accept': 'text/html'
        }
      });

      let cspInHeader = response.headers['content-security-policy'];
      let cspInMetaElement = response.body.match(CSP_META_TAG_REG_EXP)[1];
      expect(cspInHeader).to.equal(cspInMetaElement);
    });
  });

  describe('', function() {
    afterEach(async function() {
      await app.stopServer();
    });

    it('uses Content-Security-Policy-Report-Only header if `reportOnly` option is `true`', async function() {
      await setConfig(app, {
        delivery: ['header'],
        reportOnly: true,
      });

      await app.startServer();

      let response = await request({
        url: 'http://localhost:49741',
        headers: {
          'Accept': 'text/html'
        }
      });

      expect(response.headers).to.include.key('content-security-policy-report-only');
      expect(response.headers).to.not.have.key('content-security-policy');
    });
  });

  describe('', function() {
    afterEach(async function() {
      await app.stopServer();
    });

    it('does not deliver CSP if `enabled` option is `false`', async function() {
      await setConfig(app, {
        enabled: false,
      });

      await app.startServer();

      let response = await request({
        url: 'http://localhost:49741',
        headers: {
          'Accept': 'text/html'
        }
      });

      expect(response.headers).to.not.have.key('content-security-policy');
      expect(response.headers).to.not.have.key('content-security-policy-report-only');
      expect(response.body).to.not.match(CSP_META_TAG_REG_EXP);
    });
  });

  describe('supports live reload', function() {
    afterEach(async function() {
      await app.stopServer();
    });

    it('adds CSP directives required by live reload', async function() {
      await setConfig(app, {
        delivery: ['header', 'meta'],
      });

      await app.startServer();

      let response = await request({
        url: 'http://localhost:49741',
        headers: {
          'Accept': 'text/html'
        }
      });

      let cspInHeader = response.headers['content-security-policy-report-only'];
      let cspInMetaElement = response.body.match(CSP_META_TAG_REG_EXP)[1];
      [cspInHeader, cspInMetaElement].forEach((csp) => {
        expect(csp).to.match(/connect-src [^;]* ws:\/\/0.0.0.0:49741/);
        expect(csp).to.match(/connect-src [^;]* ws:\/\/localhost:49741/);
        expect(csp).to.match(/script-src [^;]* 0.0.0.0:49741/);
        expect(csp).to.match(/script-src [^;]* localhost:49741/);
      });
    });
  });
});