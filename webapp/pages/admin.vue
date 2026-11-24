<script setup lang="ts">
import { ref } from 'vue'
import AdminRecords from '../components/admin-records.vue'
import Loading from '../components/svg/loading.vue'
import { ApiError, adminLogin, adminToken, setAdminToken } from '../lib/api'

const ADMIN_USER_KEY = 'woom-admin-user'

const username = ref('')
const password = ref('')
const signedInUser = ref(sessionStorage.getItem(ADMIN_USER_KEY) ?? '')
const signedIn = ref(!!adminToken)
const busy = ref(false)
const loginError = ref('')
const notEnabled = ref(false)

const signIn = async () => {
  if (busy.value || !username.value || !password.value) return
  busy.value = true
  loginError.value = ''
  try {
    const res = await adminLogin(username.value, password.value)
    setAdminToken(res.token)
    sessionStorage.setItem(ADMIN_USER_KEY, username.value)
    signedInUser.value = username.value
    signedIn.value = true
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      notEnabled.value = true
    } else if (e instanceof ApiError && e.status === 401) {
      loginError.value = 'Invalid username or password'
    } else {
      loginError.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    busy.value = false
  }
}

const signOut = () => {
  setAdminToken('')
  sessionStorage.removeItem(ADMIN_USER_KEY)
  signedInUser.value = ''
  signedIn.value = false
  password.value = ''
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center px-4 py-10" data-testid="admin-page">
    <template v-if="!signedIn">
      <div class="my-auto flex flex-col items-center gap-8 w-full">
        <div class="text-center">
          <h1 class="text-heading text-4xl font-extrabold tracking-tight">WOOM Admin</h1>
          <p class="mt-2 text-muted">Meeting records console</p>
        </div>
        <form
          class="panel w-full max-w-sm p-6 sm:p-8 flex flex-col gap-4"
          data-testid="admin-login"
          @submit.prevent="signIn"
        >
          <template v-if="notEnabled">
            <p class="text-sm text-muted" data-testid="admin-disabled">
              The admin console is not enabled on this server
            </p>
          </template>
          <template v-else>
            <input
              v-model="username"
              class="input-control"
              placeholder="Username"
              autocomplete="username"
              data-testid="admin-username"
            />
            <input
              v-model="password"
              class="input-control"
              type="password"
              placeholder="Password"
              autocomplete="current-password"
              data-testid="admin-password"
            />
            <button
              class="btn-primary"
              type="submit"
              :disabled="!username || !password || busy"
              data-testid="admin-sign-in"
            >
              <Loading v-if="busy" />
              Sign in
            </button>
            <p v-if="loginError" class="text-sm text-danger" data-testid="admin-login-error">
              {{ loginError }}
            </p>
          </template>
        </form>
      </div>
    </template>

    <template v-else>
      <div class="w-full max-w-5xl flex flex-col gap-6">
        <header class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 class="text-heading text-2xl font-bold tracking-tight">Admin Console</h1>
            <p class="text-sm text-muted" data-testid="admin-identity">
              Signed in as {{ signedInUser }}
            </p>
          </div>
          <button
            class="icon-btn px-3 w-auto text-sm"
            data-testid="admin-sign-out"
            @click="signOut"
          >
            Sign out
          </button>
        </header>
        <AdminRecords @auth-expired="signOut" />
      </div>
    </template>
  </div>
</template>
