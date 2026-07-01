import {
  isTransactionalEmailEnabled,
  isTransactionalSmsEnabled,
  sendTransactionalEmail,
  sendTransactionalSms,
} from "./transactionalOutbound";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function withEnv(name: string, value: string | undefined, fn: () => void) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    fn();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

async function withEnvAsync(
  name: string,
  value: string | undefined,
  fn: () => Promise<void>,
) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

assert(isTransactionalSmsEnabled() === false, "SMS off by default");
assert(isTransactionalEmailEnabled() === false, "email off by default");

withEnv("TRANSACTIONAL_SMS_ENABLED", "false", () => {
  assert(isTransactionalSmsEnabled() === false, "SMS false string");
});
withEnv("TRANSACTIONAL_SMS_ENABLED", "true", () => {
  assert(isTransactionalSmsEnabled() === true, "SMS true string");
});
withEnv("TRANSACTIONAL_SMS_ENABLED", "1", () => {
  assert(isTransactionalSmsEnabled() === true, "SMS 1 string");
});
withEnv("TRANSACTIONAL_EMAIL_ENABLED", "yes", () => {
  assert(isTransactionalEmailEnabled() === true, "email yes string");
});

async function runAsyncTests() {
  await withEnvAsync("TRANSACTIONAL_SMS_ENABLED", "false", async () => {
    const sms = await sendTransactionalSms({ to: "+15551234567", body: "test" });
    assert(sms.skipped === true, "SMS skipped when disabled");
    assert(sms.ok === false, "SMS not ok when disabled");
  });

  await withEnvAsync("TRANSACTIONAL_EMAIL_ENABLED", "false", async () => {
    const email = await sendTransactionalEmail({
      to: "user@example.com",
      subject: "test",
      body: "hello",
    });
    assert(email.skipped === true, "email skipped when disabled");
    assert(email.ok === false, "email not ok when disabled");
  });

  await withEnvAsync("TRANSACTIONAL_SMS_ENABLED", "false", async () => {
    const sms = await sendTransactionalSms({ to: "", body: "x" });
    assert(sms.skipped === true, "empty SMS skipped");
  });
}

runAsyncTests()
  .then(() => {
    console.log("transactionalOutbound tests passed");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
