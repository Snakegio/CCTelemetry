import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Header } from '../../components/header';

@Component({
  selector: 'app-about',
  imports: [RouterLink, Header],
  templateUrl: './about.html',
})
export class About {}
