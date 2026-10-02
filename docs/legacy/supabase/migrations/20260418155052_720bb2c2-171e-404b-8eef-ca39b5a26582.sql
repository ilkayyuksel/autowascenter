-- Maak admin account aan en ken admin rol toe
DO $$
DECLARE
  v_user_id uuid;
  v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM auth.users WHERE email = 'admin@autowascenter.be' LIMIT 1;

  IF v_existing IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at, recovery_sent_at,
      last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      'admin@autowascenter.be',
      -- SECURITY: plaintext wachtwoord verwijderd. Bij een nieuwe DB krijgt het account
      -- een willekeurig, onbekend wachtwoord; stel het in via een wachtwoordreset.
      crypt(gen_random_uuid()::text, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      format('{"sub":"%s","email":"%s"}', v_user_id, 'admin@autowascenter.be')::jsonb,
      'email',
      v_user_id::text,
      now(), now(), now()
    );
  ELSE
    v_user_id := v_existing;
  END IF;

  -- ken admin rol toe (idempotent)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;